/**
 * Client half of the Pomodoro plugin.
 *
 * Compiled to one CommonJS file and wrapped in the DSH client-module envelope
 * by `scripts/build-client.mjs`; the only runtime import is the baseline
 * `react` module served by the browser module table.
 *
 * Contracts consumed (queried 2026-09-30 on DSH `0.1.7-rc.2`):
 * - `conversation.composer.dock` — list slot, registration `{ name, id, order, label? }`.
 * - `settings.section` — list slot, registration `{ name, id, order, label? }`.
 * - services `slots` and `locale`, declared as hard dependencies below.
 */

import type { ClientContext } from './contracts.js'
import { createRuntime } from './runtime.js'
import { createDockClock, createSettingsSection } from './view.js'

/** Service names this module cannot run without. */
export const inject = ['slots', 'locale']

/** Ambient clock under the composer card. */
const DOCK_SLOT = 'conversation.composer.dock'

/** Preferences page inside Settings. */
const SETTINGS_SLOT = 'settings.section'

/**
 * Mount both surfaces.
 *
 * Every registration and the ticker itself are attached to this plugin's
 * Fiber, so unloading or reloading the module leaves no timer or slot entry
 * behind.
 */
export function apply(ctx: ClientContext): void {
  const runtime = createRuntime(ctx)

  ctx.effect(
    () =>
      ctx.slots.inject(DOCK_SLOT, () =>
        ctx.slots.register({ name: DOCK_SLOT, id: 'skillre-pomodoro', order: 10 }, createDockClock(runtime)),
      ),
    'skillre-pomodoro dock clock',
  )

  ctx.effect(
    () =>
      ctx.slots.inject(SETTINGS_SLOT, () =>
        ctx.slots.register(
          {
            name: SETTINGS_SLOT,
            id: 'skillre-pomodoro',
            order: 30,
            label: () => runtime.translate('settings.nav'),
          },
          createSettingsSection(runtime),
        ),
      ),
    'skillre-pomodoro settings page',
  )
}
