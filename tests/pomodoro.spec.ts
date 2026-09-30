import { describe, expect, it } from 'vitest'
import {
  complete,
  cyclePosition,
  defaultConfig,
  durationMs,
  focusMinutes,
  formatClock,
  initialState,
  localDayKey,
  normalizeConfig,
  pause,
  phaseAfterWork,
  remainingAt,
  resetPhase,
  rolloverDay,
  settle,
  skipPhase,
  start,
  type PomodoroConfig,
  type PomodoroState,
} from '../src/client/pomodoro.js'
import { createPomodoroStore, STORAGE_KEY, STORAGE_VERSION, type StorageLike } from '../src/client/store.js'
import { msUntilNextLocalDay, scheduleDelay } from '../src/client/schedule.js'

/** Local noon on an arbitrary day, so day-boundary assertions are timezone-proof. */
const NOON = new Date(2026, 8, 30, 12, 0, 0).getTime()

/** A config with short, easily reasoned-about durations. */
function testConfig(patch: Partial<PomodoroConfig> = {}): PomodoroConfig {
  return { ...defaultConfig(), workMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, ...patch }
}

/** A running focus round with `elapsedMinutes` already spent. */
function runningWork(config: PomodoroConfig, elapsedMinutes: number): PomodoroState {
  return {
    ...initialState(config, NOON),
    running: true,
    endsAt: NOON + durationMs('work', config) - elapsedMinutes * 60_000,
  }
}

describe('config', () => {
  it('starts from the classic 25/5/15 cycle', () => {
    expect(defaultConfig()).toEqual({
      workMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      roundsBeforeLongBreak: 4,
      autoStartBreaks: true,
      autoStartWork: false,
    })
  })

  it('clamps out-of-range values instead of rejecting them', () => {
    const config = normalizeConfig({
      workMinutes: 9_999,
      shortBreakMinutes: 0,
      longBreakMinutes: -4,
      roundsBeforeLongBreak: 99,
    })
    expect(config.workMinutes).toBe(180)
    expect(config.shortBreakMinutes).toBe(1)
    expect(config.longBreakMinutes).toBe(1)
    expect(config.roundsBeforeLongBreak).toBe(12)
  })

  it('falls back field by field when the payload is foreign', () => {
    const config = normalizeConfig({ workMinutes: 'soon', autoStartWork: 'yes' })
    expect(config.workMinutes).toBe(25)
    expect(config.autoStartWork).toBe(false)
    expect(normalizeConfig(null)).toEqual(defaultConfig())
    expect(normalizeConfig([1, 2, 3]).roundsBeforeLongBreak).toBe(4)
  })
})

describe('clock formatting', () => {
  it('renders mm:ss and rolls over to h:mm:ss', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00')
    expect(formatClock(61_000)).toBe('01:01')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(-500)).toBe('00:00')
    expect(formatClock(3_600_000)).toBe('1:00:00')
    expect(formatClock(3_661_000)).toBe('1:01:01')
  })

  it('rounds a partial second up so the last second is visible', () => {
    expect(formatClock(1_400)).toBe('00:02')
    expect(formatClock(1)).toBe('00:01')
  })
})

describe('phase transitions', () => {
  it('starts, runs down and pauses with the remaining time preserved', () => {
    const config = testConfig()
    const idle = initialState(config, NOON)
    expect(idle.phase).toBe('work')
    expect(remainingAt(idle, NOON)).toBe(25 * 60_000)

    const running = start(idle, NOON)
    expect(running.running).toBe(true)
    expect(remainingAt(running, NOON + 60_000)).toBe(24 * 60_000)

    const paused = pause(running, NOON + 60_000)
    expect(paused.running).toBe(false)
    expect(remainingAt(paused, NOON + 600_000)).toBe(24 * 60_000)

    const resumed = start(paused, NOON + 600_000)
    expect(remainingAt(resumed, NOON + 600_000)).toBe(24 * 60_000)
    expect(remainingAt(resumed, NOON + 660_000)).toBe(23 * 60_000)
  })

  it('is idempotent when starting or pausing twice', () => {
    const config = testConfig()
    const idle = initialState(config, NOON)
    const running = start(idle, NOON)
    expect(start(running, NOON + 5_000)).toBe(running)
    expect(pause(idle, NOON)).toBe(idle)
  })

  it('never reports negative time', () => {
    const config = testConfig()
    const running = start(initialState(config, NOON), NOON)
    expect(remainingAt(running, NOON + 60 * 60_000)).toBe(0)
  })

  it('restarts the current phase at full length, paused', () => {
    const config = testConfig()
    const running = start(initialState(config, NOON), NOON)
    const reset = resetPhase(pause(running, NOON + 60_000), config)
    expect(reset.running).toBe(false)
    expect(remainingAt(reset, NOON)).toBe(25 * 60_000)
  })
})

describe('cycle advance', () => {
  it('credits a finished focus round and lands on a short break', () => {
    const config = testConfig()
    const finishedAt = NOON + 25 * 60_000
    const done = complete(initialState(config, NOON), config, finishedAt)
    expect(done.rounds).toBe(1)
    expect(done.focusMs).toBe(25 * 60_000)
    expect(done.phase).toBe('short-break')
    expect(done.running).toBe(true)
    expect(remainingAt(done, finishedAt)).toBe(5 * 60_000)
  })

  it('takes the long break on every Nth round and returns to work after it', () => {
    const config = testConfig({ roundsBeforeLongBreak: 3, autoStartBreaks: false })
    expect(phaseAfterWork(1, config)).toBe('short-break')
    expect(phaseAfterWork(2, config)).toBe('short-break')
    expect(phaseAfterWork(3, config)).toBe('long-break')
    expect(phaseAfterWork(6, config)).toBe('long-break')

    const longBreak: PomodoroState = {
      ...initialState(config, NOON),
      phase: 'long-break',
      phaseMs: durationMs('long-break', config),
      remainingMs: durationMs('long-break', config),
      rounds: 3,
      running: true,
      endsAt: NOON + 15 * 60_000,
    }
    const afterBreak = complete(longBreak, config, NOON + 15 * 60_000)
    expect(afterBreak.phase).toBe('work')
    expect(afterBreak.rounds).toBe(3)
    expect(afterBreak.focusMs).toBe(0)
  })

  it('honours the autostart switches per phase', () => {
    const off = testConfig({ autoStartBreaks: false, autoStartWork: false })
    const afterWork = complete(initialState(off, NOON), off, NOON + 25 * 60_000)
    expect(afterWork.running).toBe(false)
    expect(remainingAt(afterWork, NOON)).toBe(5 * 60_000)

    const offAfterBreak = complete({ ...afterWork, phase: 'short-break' }, off, NOON)
    expect(offAfterBreak.phase).toBe('work')
    expect(offAfterBreak.running).toBe(false)

    const on = testConfig({ autoStartBreaks: false, autoStartWork: true })
    const onAfterBreak = complete({ ...afterWork, phase: 'short-break', running: false }, on, NOON)
    expect(onAfterBreak.phase).toBe('work')
    expect(onAfterBreak.running).toBe(true)
    expect(onAfterBreak.endsAt).toBe(NOON + 25 * 60_000)
  })

  it('never lets a skipped round earn a long break', () => {
    const config = testConfig({ roundsBeforeLongBreak: 4, autoStartBreaks: false })

    // One round short of the boundary, exactly on it, and past it: a skipped
    // (uncredited) focus round must always land on the short break.
    for (const rounds of [0, 3, 4, 8]) {
      const skipped = skipPhase({ ...initialState(config, NOON), rounds }, config, NOON)
      expect(skipped.phase, `rounds=${String(rounds)}`).toBe('short-break')
      expect(skipped.rounds).toBe(rounds)
    }

    // The boundary stays owed to the round that actually earns it.
    const earned = complete({ ...initialState(config, NOON), rounds: 3 }, config, NOON)
    expect(earned.rounds).toBe(4)
    expect(earned.phase).toBe('long-break')
  })

  it('reports the cycle position, not the day counter', () => {
    const config = testConfig({ roundsBeforeLongBreak: 4 })
    const at = (rounds: number, phase: PomodoroState['phase']): number =>
      cyclePosition({ ...initialState(config, NOON), rounds, phase }, config)

    expect(at(0, 'work')).toBe(0)
    expect(at(1, 'work')).toBe(1)
    expect(at(3, 'work')).toBe(3)
    // The earned long break reads as a finished cycle ...
    expect(at(4, 'long-break')).toBe(4)
    // ... but the next focus round starts a new one instead of showing 4/4.
    expect(at(4, 'work')).toBe(0)
    expect(at(5, 'work')).toBe(1)
    expect(at(8, 'work')).toBe(0)
  })

  it('skips without crediting anything and keeps the run state', () => {
    const config = testConfig()
    const running = runningWork(config, 3)
    const skipped = skipPhase(running, config, NOON)

    expect(skipped.phase).toBe('short-break')
    expect(skipped.rounds).toBe(0)
    expect(skipped.focusMs).toBe(0)
    expect(skipped.running).toBe(true)
    expect(remainingAt(skipped, NOON)).toBe(5 * 60_000)

    const paused = skipPhase(pause(running, NOON), config, NOON)
    expect(paused.running).toBe(false)
    expect(remainingAt(paused, NOON)).toBe(5 * 60_000)
  })
})

describe('settling against the clock', () => {
  it('leaves an unexpired phase untouched and returns the same reference', () => {
    const config = testConfig()
    const running = runningWork(config, 3)
    expect(settle(running, config, NOON)).toBe(running)
  })

  it('completes an overdue phase exactly once and does not cascade', () => {
    const config = testConfig({ autoStartBreaks: true, autoStartWork: true })
    const running = runningWork(config, 0)

    const first = settle(running, config, NOON + 60 * 60_000)
    expect(first.rounds).toBe(1)
    expect(first.phase).toBe('short-break')
    // The next phase starts at `now`, not at the overshot end, so a sleeping
    // browser cannot bank a chain of phantom rounds.
    expect(first.endsAt).toBe(NOON + 60 * 60_000 + 5 * 60_000)
    expect(settle(first, config, NOON + 60 * 60_000)).toBe(first)
  })

  it('rolls the daily counters over at the local day boundary only', () => {
    const config = testConfig()
    const evening = new Date(2026, 8, 30, 23, 30, 0).getTime()
    const state: PomodoroState = { ...initialState(config, evening), rounds: 6, focusMs: 150 * 60_000 }

    expect(rolloverDay(state, evening + 60_000)).toBe(state)

    const nextDay = new Date(2026, 9, 1, 0, 30, 0).getTime()
    const rolled = rolloverDay(state, nextDay)
    expect(rolled.rounds).toBe(0)
    expect(rolled.focusMs).toBe(0)
    expect(rolled.day).toBe(localDayKey(nextDay))
  })

  it('leaves a phase that spans midnight running across the boundary', () => {
    const config = testConfig()
    const evening = new Date(2026, 8, 30, 23, 45, 0).getTime()
    const nextDay = new Date(2026, 9, 1, 0, 5, 0).getTime()
    const running = start(initialState(config, evening), evening)

    const rolled = rolloverDay(running, nextDay)
    expect(rolled.running).toBe(true)
    expect(rolled.endsAt).toBe(running.endsAt)
    expect(rolled.phase).toBe('work')
    expect(rolled.remainingMs).toBe(running.remainingMs)
  })

  it('credits a round that finishes just after midnight to the new day', () => {
    const config = testConfig()
    const evening = new Date(2026, 8, 30, 23, 45, 0).getTime()
    const afterMidnight = new Date(2026, 9, 1, 0, 10, 5).getTime()
    const state: PomodoroState = {
      ...start(initialState(config, evening), evening),
      rounds: 3,
      focusMs: 75 * 60_000,
    }

    const settled = settle(state, config, afterMidnight)
    expect(settled.day).toBe(localDayKey(afterMidnight))
    expect(settled.rounds).toBe(1)
    expect(settled.focusMs).toBe(25 * 60_000)
    expect(settled.phase).toBe('short-break')
  })

  it('reports whole focused minutes', () => {
    expect(focusMinutes(0)).toBe(0)
    expect(focusMinutes(59_999)).toBe(0)
    expect(focusMinutes(25 * 60_000)).toBe(25)
  })
})

/** A storage double that records every write. */
function memoryStorage(initial: Record<string, string> = {}): StorageLike & { readonly map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

/** A manually advanced clock. */
function fakeClock(startAt: number): { now: () => number; advance: (ms: number) => void } {
  let current = startAt
  return {
    now: () => current,
    advance: (ms) => {
      current += ms
    },
  }
}

describe('store', () => {
  it('persists every transition so a reload resumes the same round', () => {
    const config = testConfig()
    const storage = memoryStorage()
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage, now: clock.now })

    store.start()
    clock.advance(10 * 60_000)
    expect(store.snapshot().remainingMs).toBe(15 * 60_000)

    const reloaded = createPomodoroStore({ storage, now: clock.now })
    expect(reloaded.snapshot().state.running).toBe(true)
    expect(reloaded.snapshot().remainingMs).toBe(15 * 60_000)
    expect(reloaded.snapshot().config).toEqual(config)
  })

  it('credits a round that finished while the page was closed', () => {
    const storage = memoryStorage()
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage, now: clock.now })
    store.start()

    clock.advance(26 * 60_000)
    const reloaded = createPomodoroStore({ storage, now: clock.now })
    const snapshot = reloaded.snapshot()

    expect(snapshot.state.rounds).toBe(1)
    expect(snapshot.state.phase).toBe('short-break')
    expect(snapshot.state.focusMs).toBe(25 * 60_000)
  })

  it('notifies subscribers on a change and stops after dispose', () => {
    const store = createPomodoroStore({ storage: memoryStorage(), now: fakeClock(NOON).now })
    let count = 0
    const off = store.subscribe(() => {
      count += 1
    })

    store.start()
    expect(count).toBe(1)
    store.start() // already running: no state change, no notification
    expect(count).toBe(1)
    store.pause()
    expect(count).toBe(2)

    off()
    store.skip()
    expect(count).toBe(2)
  })

  it('writes the settled state back so a reload cannot replay it', () => {
    const storage = memoryStorage()
    const clock = fakeClock(NOON)
    createPomodoroStore({ storage, now: clock.now }).start()

    clock.advance(26 * 60_000)
    const reloaded = createPomodoroStore({ storage, now: clock.now })
    expect(reloaded.snapshot().state.rounds).toBe(1)

    const written = JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}') as {
      state?: { rounds?: number; phase?: string }
    }
    expect(written.state?.rounds).toBe(1)
    expect(written.state?.phase).toBe('short-break')

    // Reloading again must not move the auto-started break a second time.
    const deadline = JSON.parse(storage.map.get(STORAGE_KEY) ?? '{}') as { state?: { endsAt?: number } }
    clock.advance(60_000)
    const again = createPomodoroStore({ storage, now: clock.now })
    expect(again.snapshot().state.endsAt).toBe(deadline.state?.endsAt)
  })

  it('ignores a corrupt or foreign payload', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{not json' })
    const store = createPomodoroStore({ storage, now: fakeClock(NOON).now })
    expect(store.snapshot().state).toEqual(initialState(defaultConfig(), NOON))

    const wrongVersion = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ version: STORAGE_VERSION + 1, config: { workMinutes: 1 } }),
    })
    expect(createPomodoroStore({ storage: wrongVersion, now: fakeClock(NOON).now }).snapshot().config.workMinutes).toBe(
      25,
    )
  })

  it('survives a storage backend that throws', () => {
    const hostile: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    const store = createPomodoroStore({ storage: hostile, now: fakeClock(NOON).now })
    expect(() => {
      store.start()
    }).not.toThrow()
    expect(store.snapshot().state.running).toBe(true)
  })

  it('runs in memory when no storage is available', () => {
    const store = createPomodoroStore({ now: fakeClock(NOON).now })
    store.start()
    expect(store.snapshot().state.running).toBe(true)
  })

  it('clamps a configuration edit and follows a phase the user has not touched', () => {
    const store = createPomodoroStore({ storage: memoryStorage(), now: fakeClock(NOON).now })
    expect(store.snapshot().remainingMs).toBe(25 * 60_000)

    store.updateConfig({ workMinutes: 40 })
    expect(store.snapshot().config.workMinutes).toBe(40)
    expect(store.snapshot().remainingMs).toBe(40 * 60_000)

    store.updateConfig({ workMinutes: 9_999 })
    expect(store.snapshot().config.workMinutes).toBe(180)
  })

  it('leaves a phase already under way on its own length', () => {
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage: memoryStorage(), now: clock.now })
    store.start()
    clock.advance(10 * 60_000)

    store.updateConfig({ workMinutes: 40 })
    expect(store.snapshot().remainingMs).toBe(15 * 60_000)
  })

  it('zeroes today without disturbing the running phase', () => {
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage: memoryStorage(), now: clock.now })
    store.start()
    clock.advance(25 * 60_000)
    store.settle()
    expect(store.snapshot().state.rounds).toBe(1)

    store.resetToday()
    const snapshot = store.snapshot()
    expect(snapshot.state.rounds).toBe(0)
    expect(snapshot.state.focusMs).toBe(0)
    expect(snapshot.state.phase).toBe('short-break')
  })

  it('credits the length the round actually ran, not a mid-round duration change', () => {
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage: memoryStorage(), now: clock.now })
    store.start()
    clock.advance(10 * 60_000)

    store.updateConfig({ workMinutes: 40 })
    expect(store.snapshot().remainingMs).toBe(15 * 60_000)

    clock.advance(15 * 60_000)
    store.settle()
    expect(store.snapshot().state.rounds).toBe(1)
    expect(store.snapshot().state.focusMs).toBe(25 * 60_000)
  })

  it('credits the round when pausing in the window after the phase expired', () => {
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage: memoryStorage(), now: clock.now })
    store.start()
    clock.advance(25 * 60_000 + 400)

    store.pause()
    const snapshot = store.snapshot()
    expect(snapshot.state.rounds).toBe(1)
    expect(snapshot.state.focusMs).toBe(25 * 60_000)
    expect(snapshot.state.phase).toBe('short-break')
    expect(snapshot.state.running).toBe(false)
    expect(snapshot.remainingMs).toBe(5 * 60_000)
  })

  it('discards a payload written before the phase length was frozen', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 1,
        config: { workMinutes: 40 },
        state: { phase: 'work', running: true, endsAt: NOON + 15 * 60_000, remainingMs: 15 * 60_000 },
      }),
    })
    const snapshot = createPomodoroStore({ storage, now: fakeClock(NOON).now }).snapshot()
    expect(snapshot.state).toEqual(initialState(defaultConfig(), NOON))
    expect(snapshot.config.workMinutes).toBe(25)
  })

  it('falls back to the configured length when a restored one is unusable', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: STORAGE_VERSION,
        state: { phase: 'work', running: false, phaseMs: 0, remainingMs: 0 },
      }),
    })
    const snapshot = createPomodoroStore({ storage, now: fakeClock(NOON).now }).snapshot()
    expect(snapshot.state.phaseMs).toBe(25 * 60_000)
    expect(snapshot.remainingMs).toBe(25 * 60_000)
  })

  it('does not credit a phantom round from a running flag without a deadline', () => {
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: STORAGE_VERSION,
        state: { running: true, phase: 'work', remainingMs: 25 * 60_000 },
      }),
    })
    const snapshot = createPomodoroStore({ storage, now: fakeClock(NOON).now }).snapshot()
    expect(snapshot.state.running).toBe(false)
    expect(snapshot.state.rounds).toBe(0)
    expect(snapshot.state.focusMs).toBe(0)
  })

  it('settle is a no-op while the phase is running normally', () => {
    const store = createPomodoroStore({ storage: memoryStorage(), now: fakeClock(NOON).now })
    store.start()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    store.settle()
    store.settle()
    expect(notifications).toBe(0)
  })
})


describe('ticker scheduling', () => {
  it('polls once a second while running, with a floor so a spent phase cannot spin', () => {
    const config = testConfig()
    const clock = fakeClock(NOON)
    const store = createPomodoroStore({ storage: memoryStorage(), now: clock.now })

    store.start()
    expect(scheduleDelay(store.snapshot(), NOON)).toBe(1_000)
    clock.advance(24 * 60_000 + 59_000)
    expect(scheduleDelay(store.snapshot(), clock.now())).toBe(1_000)

    // A phase due within the floor is polled at the floor, never at 0 ms.
    clock.advance(1_000)
    store.settle()
    expect(scheduleDelay(store.snapshot(), clock.now())).toBeLessThanOrEqual(1_000)
  })

  it('sleeps to the next local midnight when idle', () => {
    const config = testConfig()
    const store = createPomodoroStore({ storage: memoryStorage(), now: fakeClock(NOON).now })
    expect(scheduleDelay(store.snapshot(), NOON)).toBe(msUntilNextLocalDay(NOON))
    expect(scheduleDelay(store.snapshot(), NOON)).toBeGreaterThan(60 * 60_000)

    const justBeforeMidnight = new Date(2026, 8, 30, 23, 59, 59, 900).getTime()
    // The 200 ms anti-spin floor wins: a wake-up is never scheduled for less.
    expect(msUntilNextLocalDay(justBeforeMidnight)).toBe(200)
  })

  it('never schedules a non-positive delay', () => {
    const freshMidnight = new Date(2026, 8, 30, 0, 0, 0, 0).getTime()
    expect(msUntilNextLocalDay(freshMidnight)).toBeGreaterThan(0)
  })
})
