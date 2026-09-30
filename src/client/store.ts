/**
 * Persistence and subscriptions for the Pomodoro timer.
 *
 * The store owns the mutable timer state, writes it through to a storage-like
 * backend (the browser's `localStorage` in production) and notifies
 * subscribers. It contains no React and no Cordis so it can be driven directly
 * from tests with a fake clock and a fake storage.
 */

import {
  defaultConfig,
  durationMs,
  initialState,
  normalizeConfig,
  pause,
  PHASE_KINDS,
  remainingAt,
  resetPhase,
  resetToday as resetTodayState,
  rolloverDay,
  settle as settleState,
  skipPhase,
  start,
  type PhaseKind,
  type PomodoroConfig,
  type PomodoroState,
} from './pomodoro.js'

/** The storage surface the store needs; `localStorage` satisfies it. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

/** One immutable view of the timer, recomputed against the current clock. */
export interface PomodoroSnapshot {
  readonly state: PomodoroState
  readonly config: PomodoroConfig
  /** Milliseconds left in the current phase right now. */
  readonly remainingMs: number
  /** Whole length the current phase was started with (frozen, not the current config). */
  readonly phaseDurationMs: number
}

/** The timer facade the UI and the ticker share. */
export interface PomodoroStore {
  /** Current state, with the remaining time measured against the clock. */
  snapshot(): PomodoroSnapshot
  /** Observe every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Start or resume the current phase. */
  start(): void
  /** Freeze the current phase. */
  pause(): void
  /** Start when paused, pause when running. */
  toggle(): void
  /** Restart the current phase from its full length. */
  reset(): void
  /** Move to the next phase without crediting the current one. */
  skip(): void
  /** Roll the day over and finish an elapsed phase. Cheap when nothing changed. */
  settle(): void
  /** Apply a partial configuration edit, clamped into range. */
  updateConfig(patch: Partial<PomodoroConfig>): void
  /** Zero today's counters. */
  resetToday(): void
  /** Drop every subscriber; later mutations still persist. */
  dispose(): void
}

/** Options accepted by {@link createPomodoroStore}. */
export interface PomodoroStoreOptions {
  /** Backend used for persistence; omit for a memory-only store. */
  readonly storage?: StorageLike | undefined
  /** Clock, injectable for tests. */
  readonly now?: (() => number) | undefined
}

/** Storage key. The schema version lives in the payload, not in the key. */
export const STORAGE_KEY = 'skillre-pomodoro/state'

/**
 * Payload schema version inside {@link STORAGE_KEY}.
 *
 * 2 added the frozen `phaseMs`. A version-1 record has no frozen length, so
 * restoring it would have to synthesize one from the *live* config and could
 * credit a round for a length it never ran; such records are discarded and the
 * timer restarts paused instead.
 */
export const STORAGE_VERSION = 2

/** Narrow an unknown value to a persisted phase kind. */
function toPhaseKind(value: unknown, fallback: PhaseKind): PhaseKind {
  return PHASE_KINDS.includes(value as PhaseKind) ? (value as PhaseKind) : fallback
}

/** Read one finite, non-negative number, or fall back. */
function toCount(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}

/**
 * Validate a restored state against the current config.
 *
 * Anything unusable degrades to a fresh paused timer rather than a broken one.
 */
function normalizeState(input: unknown, config: PomodoroConfig, now: number): PomodoroState {
  const fallback = initialState(config, now)
  if (typeof input !== 'object' || input === null) return fallback
  const record = input as Record<string, unknown>
  const phase = toPhaseKind(record.phase, fallback.phase)
  const storedPhaseMs = toCount(record.phaseMs, 0)
  // A record without a usable frozen length cannot be trusted for timing: its
  // remaining time belongs to an unknown phase length, and keeping it would let
  // Start expire instantly and credit a round that never ran.
  const usableTiming = storedPhaseMs > 0
  const phaseMs = usableTiming ? storedPhaseMs : durationMs(phase, config)
  const endsAt = toCount(record.endsAt, 0)
  // A "running" flag without a usable deadline is not a running phase: letting
  // it through would settle instantly and credit a round that never happened.
  const running = usableTiming && record.running === true && endsAt > 0
  const remainingMs = usableTiming ? Math.min(toCount(record.remainingMs, phaseMs), phaseMs) : phaseMs
  return {
    phase,
    running,
    endsAt: running ? endsAt : 0,
    remainingMs,
    phaseMs,
    rounds: toCount(record.rounds, 0),
    focusMs: toCount(record.focusMs, 0),
    day: typeof record.day === 'string' && record.day !== '' ? record.day : fallback.day,
  }
}

/** Parse a persisted payload; a corrupt or foreign payload yields `undefined`. */
function readPersisted(storage: StorageLike): unknown {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null) return undefined
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    if (record.version !== STORAGE_VERSION) return undefined
    return record
  } catch {
    return undefined
  }
}

/**
 * Create the store, restoring any persisted state and immediately settling a
 * phase that elapsed while the page was closed.
 */
export function createPomodoroStore(options: PomodoroStoreOptions = {}): PomodoroStore {
  const storage = options.storage
  const clock = options.now ?? ((): number => Date.now())
  const persisted = storage ? readPersisted(storage) : undefined
  const persistedRecord = (persisted ?? {}) as Record<string, unknown>

  let config = normalizeConfig(persistedRecord.config ?? defaultConfig())
  const restored = normalizeState(persistedRecord.state, config, clock())

  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const persist = (): void => {
    if (!storage) return
    try {
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, config, state }),
      )
    } catch {
      // A full or unavailable store must never break the running timer.
    }
  }

  /**
   * Settle first, then act.
   *
   * An action runs on a phase that already expired between two ticks (the
   * window is up to a second wide). Settling first credits that finished round
   * and moves on, so pausing, resetting or skipping can never silently discard
   * a completed focus round or park the timer at a frozen 00:00.
   */
  const live = (now: number): PomodoroState => settleState(state, config, now)

  // Settle a phase that elapsed while the page was closed, and write the result
  // back: an unwritten settle would let every later reload replay the same
  // completion and restart the auto-started phase at that load's clock.
  let state = restored
  const settledOnLoad = settleState(rolloverDay(restored, clock()), config, clock())
  if (settledOnLoad !== state) {
    state = settledOnLoad
    persist()
  }

  /** Apply a transition; persist and notify only when the state actually moved. */
  const commit = (next: PomodoroState): void => {
    if (next === state) return
    state = next
    persist()
    notify()
  }

  return {
    snapshot(): PomodoroSnapshot {
      const now = clock()
      return {
        state,
        config,
        remainingMs: remainingAt(state, now),
        phaseDurationMs: state.phaseMs,
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start(): void {
      const now = clock()
      commit(start(live(now), now))
    },
    pause(): void {
      const now = clock()
      commit(pause(live(now), now))
    },
    toggle(): void {
      const now = clock()
      const current = live(now)
      commit(current.running ? pause(current, now) : start(current, now))
    },
    reset(): void {
      commit(resetPhase(live(clock()), config))
    },
    skip(): void {
      const now = clock()
      commit(skipPhase(live(now), config, now))
    },
    settle(): void {
      commit(settleState(state, config, clock()))
    },
    updateConfig(patch: Partial<PomodoroConfig>): void {
      const previous = config
      const next = normalizeConfig({ ...config, ...patch })
      if (
        next.workMinutes === previous.workMinutes &&
        next.shortBreakMinutes === previous.shortBreakMinutes &&
        next.longBreakMinutes === previous.longBreakMinutes &&
        next.roundsBeforeLongBreak === previous.roundsBeforeLongBreak &&
        next.autoStartBreaks === previous.autoStartBreaks &&
        next.autoStartWork === previous.autoStartWork
      ) {
        return
      }
      // A phase the user has not touched yet follows a duration change; a
      // phase already under way keeps the length and the time it has left, and
      // `complete` credits that frozen length rather than the new config's.
      const untouched = !state.running && state.remainingMs === state.phaseMs
      config = next
      if (untouched) {
        const phaseMs = durationMs(state.phase, next)
        state = { ...state, phaseMs, remainingMs: phaseMs }
      }
      persist()
      notify()
    },
    resetToday(): void {
      commit(resetTodayState(state, clock()))
    },
    dispose(): void {
      listeners.clear()
    },
  }
}
