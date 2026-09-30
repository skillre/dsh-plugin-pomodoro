/**
 * Pure Pomodoro domain: phases, transitions, daily counters and formatting.
 *
 * Deliberately free of React, DOM, storage and Cordis so the whole state
 * machine is unit-testable and the Client half stays a rendering layer.
 *
 * Data owner: the browser UI. A focus timer is per-user UI state, not
 * model-visible session data, so it never enters the Session log.
 */

/** The three phases of one Pomodoro cycle. */
export type PhaseKind = 'work' | 'short-break' | 'long-break'

/** Every phase kind, in cycle order. */
export const PHASE_KINDS = ['work', 'short-break', 'long-break'] as const

/** User-tunable durations and automation. Durations are whole minutes. */
export interface PomodoroConfig {
  /** Minutes of one focus round. */
  readonly workMinutes: number
  /** Minutes of a break after a regular focus round. */
  readonly shortBreakMinutes: number
  /** Minutes of the break after `roundsBeforeLongBreak` focus rounds. */
  readonly longBreakMinutes: number
  /** Completed focus rounds between two long breaks. */
  readonly roundsBeforeLongBreak: number
  /** Start a break without waiting for the user. */
  readonly autoStartBreaks: boolean
  /** Start the next focus round without waiting for the user. */
  readonly autoStartWork: boolean
}

/** Accepted bounds. Out-of-range input is clamped, never rejected. */
export const LIMITS = {
  minMinutes: 1,
  maxMinutes: 180,
  minRounds: 1,
  maxRounds: 12,
} as const

/** Timer state. `endsAt` is authoritative while running, `remainingMs` while paused. */
export interface PomodoroState {
  readonly phase: PhaseKind
  readonly running: boolean
  /** Epoch milliseconds at which the current phase ends; meaningful while running. */
  readonly endsAt: number
  /** Milliseconds left in the current phase; authoritative while paused. */
  readonly remainingMs: number
  /**
   * Whole length of the current phase, frozen when that phase began.
   *
   * Kept in the state rather than recomputed from the config because the user
   * can edit durations mid-round: the running phase keeps the length it was
   * started with, and the round must be credited for that length, not for
   * whatever the config happens to say when it finishes.
   */
  readonly phaseMs: number
  /** Completed focus rounds on `day`. */
  readonly rounds: number
  /** Completed focus milliseconds on `day`. */
  readonly focusMs: number
  /** Local calendar day (`YYYY-MM-DD`) the counters belong to. */
  readonly day: string
}

/** The plugin's out-of-the-box durations: the classic 25/5/15 with a 4-round cycle. */
export function defaultConfig(): PomodoroConfig {
  return {
    workMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    roundsBeforeLongBreak: 4,
    autoStartBreaks: true,
    autoStartWork: false,
  }
}

/** Clamp a possibly hostile number into `[min, max]`, falling back when unusable. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Keep a boolean, or fall back when the value is not one. */
function keepBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Coerce arbitrary input (a persisted record, a user edit) into a valid config.
 *
 * Every field is clamped or defaulted, so a corrupt or older payload degrades
 * into a usable configuration instead of breaking the timer.
 */
export function normalizeConfig(input: unknown): PomodoroConfig {
  const fallback = defaultConfig()
  if (typeof input !== 'object' || input === null) return fallback
  const record = input as Record<string, unknown>
  return {
    workMinutes: clampInt(record.workMinutes, LIMITS.minMinutes, LIMITS.maxMinutes, fallback.workMinutes),
    shortBreakMinutes: clampInt(
      record.shortBreakMinutes,
      LIMITS.minMinutes,
      LIMITS.maxMinutes,
      fallback.shortBreakMinutes,
    ),
    longBreakMinutes: clampInt(
      record.longBreakMinutes,
      LIMITS.minMinutes,
      LIMITS.maxMinutes,
      fallback.longBreakMinutes,
    ),
    roundsBeforeLongBreak: clampInt(
      record.roundsBeforeLongBreak,
      LIMITS.minRounds,
      LIMITS.maxRounds,
      fallback.roundsBeforeLongBreak,
    ),
    autoStartBreaks: keepBoolean(record.autoStartBreaks, fallback.autoStartBreaks),
    autoStartWork: keepBoolean(record.autoStartWork, fallback.autoStartWork),
  }
}

/** Whole length of one phase in milliseconds. */
export function durationMs(phase: PhaseKind, config: PomodoroConfig): number {
  switch (phase) {
    case 'work':
      return config.workMinutes * 60_000
    case 'short-break':
      return config.shortBreakMinutes * 60_000
    case 'long-break':
      return config.longBreakMinutes * 60_000
  }
}

/** Local calendar day key (`YYYY-MM-DD`) used for the daily counters. */
export function localDayKey(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/** A fresh, paused timer sitting at the start of a focus round. */
export function initialState(config: PomodoroConfig, now: number): PomodoroState {
  const phaseMs = durationMs('work', config)
  return {
    phase: 'work',
    running: false,
    endsAt: 0,
    remainingMs: phaseMs,
    phaseMs,
    rounds: 0,
    focusMs: 0,
    day: localDayKey(now),
  }
}

/** Milliseconds left in the current phase, measured against `now`. */
export function remainingAt(state: PomodoroState, now: number): number {
  const raw = state.running ? state.endsAt - now : state.remainingMs
  return Math.max(0, raw)
}

/** Start (or resume) the current phase at `now`. */
export function start(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state
  const remaining = remainingAt(state, now)
  return { ...state, running: true, endsAt: now + remaining, remainingMs: remaining }
}

/** Freeze the running phase, keeping the time left. */
export function pause(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state
  const remaining = remainingAt(state, now)
  return { ...state, running: false, endsAt: 0, remainingMs: remaining }
}

/** Restart the current phase from its full length, paused. */
export function resetPhase(state: PomodoroState, config: PomodoroConfig): PomodoroState {
  const phaseMs = durationMs(state.phase, config)
  return { ...state, running: false, endsAt: 0, remainingMs: phaseMs, phaseMs }
}

/**
 * How many focus rounds of the current cycle are done, for display.
 *
 * `state.rounds` is the day counter and never resets per cycle, so the cycle
 * position is its remainder; while the earned long break runs, the cycle reads
 * as complete.
 */
export function cyclePosition(state: PomodoroState, config: PomodoroConfig): number {
  const inCycle = state.rounds % config.roundsBeforeLongBreak
  if (state.phase === 'long-break' && state.rounds > 0 && inCycle === 0) return config.roundsBeforeLongBreak
  return inCycle
}

/** Which phase follows a completed focus round, given the rounds credited so far. */
export function phaseAfterWork(rounds: number, config: PomodoroConfig): PhaseKind {
  if (rounds > 0 && rounds % config.roundsBeforeLongBreak === 0) return 'long-break'
  return 'short-break'
}

/**
 * Complete the current phase and move on, crediting a finished focus round.
 *
 * The next phase starts at `now`, never at the overshot `endsAt`, so a phase
 * that expired while the browser was asleep cannot cascade through the cycle.
 */
export function complete(state: PomodoroState, config: PomodoroConfig, now: number): PomodoroState {
  const finished = state.phase
  const rounds = finished === 'work' ? state.rounds + 1 : state.rounds
  // Credit the length this round actually ran, not the current config's.
  const focusMs = finished === 'work' ? state.focusMs + state.phaseMs : state.focusMs
  const phase = finished === 'work' ? phaseAfterWork(rounds, config) : 'work'
  const autoStart = finished === 'work' ? config.autoStartBreaks : config.autoStartWork
  const phaseMs = durationMs(phase, config)
  return {
    phase,
    running: autoStart,
    endsAt: autoStart ? now + phaseMs : 0,
    remainingMs: phaseMs,
    phaseMs,
    rounds,
    focusMs,
    day: state.day,
  }
}

/** Move to the next phase without crediting anything, keeping the run state. */
export function skipPhase(state: PomodoroState, config: PomodoroConfig, now: number): PomodoroState {
  // A skipped round credits nothing, so it never earns a long break: the user
  // who skips a focus round gets the short break, whatever the cadence says.
  const phase: PhaseKind = state.phase === 'work' ? 'short-break' : 'work'
  const phaseMs = durationMs(phase, config)
  return {
    ...state,
    phase,
    running: state.running,
    endsAt: state.running ? now + phaseMs : 0,
    remainingMs: phaseMs,
    phaseMs,
  }
}

/**
 * Clear the daily counters when the local day changed.
 *
 * Returns the same reference when nothing changed, so a per-second caller
 * costs nothing downstream.
 */
export function rolloverDay(state: PomodoroState, now: number): PomodoroState {
  const day = localDayKey(now)
  if (state.day === day) return state
  return { ...state, day, rounds: 0, focusMs: 0 }
}

/** Zero today's counters, keeping the phase and its remaining time. */
export function resetToday(state: PomodoroState, now: number): PomodoroState {
  return { ...state, day: localDayKey(now), rounds: 0, focusMs: 0 }
}

/**
 * Bring the state up to date for `now`: roll the day over, then finish an
 * elapsed phase. Returns the same reference when nothing changed.
 */
export function settle(state: PomodoroState, config: PomodoroConfig, now: number): PomodoroState {
  const rolled = rolloverDay(state, now)
  if (!rolled.running || now < rolled.endsAt) return rolled
  return complete(rolled, config, now)
}

/** Format a remaining duration as `mm:ss`, or `h:mm:ss` past an hour. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** Whole minutes focused today, for display. */
export function focusMinutes(focusMs: number): number {
  return Math.floor(Math.max(0, focusMs) / 60_000)
}
