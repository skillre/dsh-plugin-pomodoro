import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * Integration test for the built browser artifact.
 *
 * `npm test` builds `lib/client.js` first, and this test loads it the way the
 * shell does: one `window.__ModuleLoader__.load` registration whose factory
 * receives a `require` that can only resolve the browser module table. It
 * fails if the build ever smuggles in a second module dependency — the exact
 * failure that would otherwise surface only as an empty slot in the page.
 */

/** Path of the built browser artifact; `npm test` builds it before running. */
const BUNDLE_PATH = new URL('../lib/client.js', import.meta.url)

/** One registration captured from the shell's module loader. */
interface LoadedModule {
  readonly id: string
  readonly factory: (require: (id: string) => unknown) => Record<string, unknown>
}

/** Read the built bundle, explaining the fix when it is missing. */
function readBundle(): string {
  try {
    return readFileSync(BUNDLE_PATH, 'utf8')
  } catch {
    throw new Error('lib/client.js is missing: run `npm run build:client` (or `npm test`) first')
  }
}

/** Load the bundle in a fresh sandbox and return its single registration. */
function loadBundle(): LoadedModule {
  const loaded: LoadedModule[] = []
  runInNewContext(readBundle(), {
    window: {
      __ModuleLoader__: {
        load: (entry: LoadedModule) => {
          loaded.push(entry)
        },
      },
    },
    // The browser globals the client half touches outside React.
    document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  expect(loaded).toHaveLength(1)
  const entry = loaded[0]
  if (!entry) throw new Error('the bundle registered no module')
  return entry
}

/** A minimal React double covering the hooks the client half calls. */
const REACT_STUB = {
  createElement: () => null,
  useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => {}],
  useEffect: () => {},
}

describe('client bundle', () => {
  it('registers exactly one module under the package name', () => {
    expect(loadBundle().id).toBe('@skillre/dsh-plugin-pomodoro')
  })

  it('requires nothing but the baseline react module', () => {
    const required: string[] = []
    loadBundle().factory((id) => {
      required.push(id)
      return REACT_STUB
    })
    expect(required).toEqual(['react'])
  })

  it('exports the Cordis client plugin contract', () => {
    const plugin = loadBundle().factory(() => REACT_STUB)
    expect(plugin.apply).toBeTypeOf('function')
    expect(plugin.inject).toEqual(['slots', 'locale'])
  })

  it('registers both surfaces on their declared slots and disposes them', () => {
    const plugin = loadBundle().factory(() => REACT_STUB)
    const apply = plugin.apply as (ctx: unknown) => void

    const registered: Array<{ slot: string; id: string; component: unknown }> = []
    const disposed: string[] = []
    const effects: Array<() => void> = []
    const dictionaries: Array<{ ns: string; locale: string; dict: Record<string, string> }> = []
    const unregistered: string[] = []

    const ctx = {
      effect: (callback: () => unknown) => {
        const cleanup = callback()
        if (typeof cleanup === 'function') effects.push(cleanup as () => void)
        return () => {}
      },
      locale: {
        getLocale: () => ({
          active: 'en',
          locales: [
            { id: 'en', label: 'English' },
            { id: 'zh-CN', label: '简体中文', fallback: 'zh' },
          ],
          revision: 1,
        }),
        subscribe: () => () => {},
        register: (ns: string, locale: string, dict: Record<string, string>) => {
          dictionaries.push({ ns, locale, dict })
          return () => {
            unregistered.push(`${ns}:${locale}`)
          }
        },
        bind: () => (key: string) => key,
      },
      slots: {
        inject: (_slot: string, callback: () => () => void) => callback(),
        register: (options: { name: string; id: string }, component: unknown) => {
          registered.push({ slot: options.name, id: options.id, component })
          return () => {
            disposed.push(options.id)
          }
        },
      },
    }

    apply(ctx)

    expect(registered.map((entry) => entry.slot).sort()).toEqual([
      'conversation.composer.dock',
      'settings.section',
    ])
    expect(registered.every((entry) => entry.id === 'skillre-pomodoro')).toBe(true)
    expect(registered.every((entry) => typeof entry.component === 'function')).toBe(true)

    // Every declared locale gets exactly one dictionary: the shipped `en`/`zh`
    // pair plus Chinese for the declared `zh-CN` (deduped against `zh`).
    expect(dictionaries.map((entry) => entry.locale).sort()).toEqual(['en', 'zh', 'zh-CN'])
    expect(new Set(dictionaries.map((entry) => entry.ns))).toEqual(new Set(['skillre-pomodoro']))
    const english = dictionaries.find((entry) => entry.locale === 'en')?.dict ?? {}
    const chinese = dictionaries.find((entry) => entry.locale === 'zh')?.dict ?? {}
    expect(Object.keys(english).length).toBeGreaterThan(20)
    expect(Object.keys(english).sort()).toEqual(Object.keys(chinese).sort())
    expect(english['dock.phase.work']).toBe('Focus')
    expect(chinese['dock.phase.work']).toBe('专注')

    for (const cleanup of effects) cleanup()
    expect(disposed).toHaveLength(2)
    expect(unregistered).toHaveLength(dictionaries.length)
  })
})
