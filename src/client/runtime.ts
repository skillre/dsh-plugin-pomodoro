/**
 * Runtime glue for the Client half.
 *
 * Owns the store, the locale dictionaries, the ticker and the change fan-out.
 * Everything it registers belongs to the plugin's Fiber, so a module reload or
 * a profile change disposes the timer with no residue.
 */

import type { ClientContext, Disposer } from './contracts.js'
import type { PomodoroConfig } from './pomodoro.js'
import { scheduleDelay } from './schedule.js'
import { createPomodoroStore, type PomodoroSnapshot, type StorageLike } from './store.js'
import { dictFor, NAMESPACE, type PomodoroTextKey } from './text.js'

/** The read/write face the views use. */
export interface PomodoroRuntime {
  /** Current timer state, measured against the clock. */
  snapshot(): PomodoroSnapshot
  /** Observe timer and locale changes. */
  subscribe(listener: () => void): Disposer
  /** Localized text for one catalogue key. */
  translate(key: PomodoroTextKey): string
  /** Settle an elapsed phase, then republish. */
  refresh(): void
  start(): void
  pause(): void
  toggle(): void
  reset(): void
  skip(): void
  updateConfig(patch: Partial<PomodoroConfig>): void
  resetToday(): void
}

/** Browser `localStorage`, or `undefined` when it is absent or unusable. */
function browserStorage(): StorageLike | undefined {
  try {
    const candidate = (globalThis as unknown as { localStorage?: StorageLike }).localStorage
    if (!candidate) return undefined
    const probe = `${NAMESPACE}/probe`
    candidate.setItem(probe, '1')
    candidate.removeItem?.(probe)
    return candidate
  } catch {
    // Private-mode or quota-denied storage: run in memory instead of failing.
    return undefined
  }
}

/** Register the plugin's dictionaries for every locale the runtime declares. */
function registerDictionaries(ctx: ClientContext): Disposer {
  const ids = new Set<string>(['en', 'zh'])
  for (const locale of ctx.locale.getLocale().locales) ids.add(locale.id)
  const disposers: Disposer[] = []
  for (const id of ids) {
    try {
      disposers.push(ctx.locale.register(NAMESPACE, id, { ...dictFor(id) }))
    } catch {
      // `register` throws on a duplicate (namespace, locale) pair, which a
      // stale bundle generation can still hold. Losing one dictionary degrades
      // that language to readable key text; letting it escape would blank the
      // whole plugin, so it is contained here.
    }
  }
  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * Keep the countdown honest without a permanent per-second wake-up.
 *
 * A running phase is polled once per second; an idle timer sleeps until the
 * next local midnight, which is the earliest moment its display can change.
 * The listener list is the reschedule signal, so pressing a control takes
 * effect immediately, and a background tab that missed its wake-up settles
 * from absolute timestamps the moment it is scheduled again or becomes visible.
 */
function startTicker(ctx: ClientContext, runtime: PomodoroRuntime): void {
  ctx.effect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined
    let disposed = false

    const schedule = (): void => {
      if (disposed) return
      if (handle !== undefined) clearTimeout(handle)
      const delay = scheduleDelay(runtime.snapshot(), Date.now())
      handle = setTimeout(() => {
        runtime.refresh()
        schedule()
      }, delay)
    }

    const onVisibility = (): void => {
      if (!document.hidden) runtime.refresh()
    }

    const offChange = runtime.subscribe(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    schedule()

    return () => {
      disposed = true
      if (handle !== undefined) clearTimeout(handle)
      offChange()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, 'skillre-pomodoro ticker')
}

/** Build the runtime and attach every side effect to the plugin's Fiber. */
export function createRuntime(ctx: ClientContext): PomodoroRuntime {
  ctx.effect(() => registerDictionaries(ctx), 'skillre-pomodoro dictionaries')

  const store = createPomodoroStore({ storage: browserStorage() })
  const bound = ctx.locale.bind(NAMESPACE)
  const listeners = new Set<() => void>()

  const publish = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const offStore = store.subscribe(publish)
  const offLocale = ctx.locale.subscribe(publish)
  ctx.effect(
    () => () => {
      offStore()
      offLocale()
    },
    'skillre-pomodoro subscriptions',
  )

  const runtime: PomodoroRuntime = {
    snapshot: () => store.snapshot(),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    translate: (key) => bound(key),
    refresh: () => {
      store.settle()
      publish()
    },
    start: () => {
      store.start()
    },
    pause: () => {
      store.pause()
    },
    toggle: () => {
      store.toggle()
    },
    reset: () => {
      store.reset()
    },
    skip: () => {
      store.skip()
    },
    updateConfig: (patch) => {
      store.updateConfig(patch)
    },
    resetToday: () => {
      store.resetToday()
    },
  }

  startTicker(ctx, runtime)
  return runtime
}
