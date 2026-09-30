/**
 * Host half of the Pomodoro bundle.
 *
 * The bundle needs exactly one Host row so the Loader can mount the package;
 * all behaviour lives in the Client half (`src/client/index.ts`), which renders
 * into `conversation.composer.dock` and `settings.section`.
 *
 * Nothing here reads a Session, registers a Tool, injects prompt text or
 * touches the filesystem. Deliberately so: a focus timer is per-user UI state,
 * and the Session log stays the only source of truth for everything the model
 * can see. If this half ever needs real Host behaviour, query the current
 * Service/Event contracts first and attach every effect to this Fiber.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name. Keep it stable after the first public release. */
export const name = 'skillre-pomodoro'

/** Mount the bundle row; the Client half owns all rendering and state. */
export function apply(_ctx: Context): void {}
