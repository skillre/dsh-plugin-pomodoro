/**
 * Wake-up scheduling for the countdown ticker.
 *
 * DOM-free and Cordis-free on purpose: the delay decision is the part worth
 * testing, and separating it keeps the browser-only glue in `runtime.ts`.
 */

import type { PomodoroSnapshot } from './store.js'

/** Countdown refresh cadence while a phase is running. */
export const TICK_MS = 1_000

/** Floor for a scheduled wake-up, so a nearly finished phase cannot spin. */
export const MIN_DELAY_MS = 200

/** Milliseconds from `now` until the next local midnight. */
export function msUntilNextLocalDay(now: number): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(MIN_DELAY_MS, next.getTime() - now)
}

/** How long to sleep before the next refresh, in milliseconds. */
export function scheduleDelay(snapshot: PomodoroSnapshot, now: number): number {
  if (snapshot.state.running) {
    return Math.max(MIN_DELAY_MS, Math.min(TICK_MS, snapshot.remainingMs))
  }
  // Idle: the only thing left to notice is the daily counter rollover.
  return msUntilNextLocalDay(now)
}
