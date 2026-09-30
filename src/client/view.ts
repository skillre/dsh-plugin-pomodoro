/**
 * The two React surfaces of the Pomodoro plugin.
 *
 * Styling uses only `--dsw-alias-*` theme tokens and plugin-prefixed classes,
 * so the controls follow light and dark themes without touching product DOM.
 * Each surface ships its own `<style>` element: React removes it on unmount,
 * which keeps the plugin's CSS scoped to the plugin's own lifetime.
 */

import { createElement, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { cyclePosition, formatClock, focusMinutes, LIMITS, type PhaseKind } from './pomodoro.js'
import type { PomodoroRuntime } from './runtime.js'
import type { PomodoroSnapshot } from './store.js'

/** `createElement` under a short local name, as the Client half avoids JSX. */
const h = createElement

/** Style sheet for the ambient dock clock. */
export const DOCK_CSS = `
.skp-pomodoro-dock { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.skp-pomodoro-pill {
  display: inline-flex; align-items: center; gap: 8px;
  height: 28px; padding: 0 6px 0 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 1; user-select: none;
}
.skp-pomodoro-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-brand-primary);
}
.skp-pomodoro-pill[data-phase="short-break"] .skp-pomodoro-dot,
.skp-pomodoro-pill[data-phase="long-break"] .skp-pomodoro-dot {
  background: var(--dsw-alias-state-success-primary);
}
.skp-pomodoro-phase { white-space: nowrap; }
.skp-pomodoro-clock {
  min-width: 44px; text-align: right;
  color: var(--dsw-alias-label-primary);
  font-weight: 600; font-variant-numeric: tabular-nums;
}
.skp-pomodoro-pill[data-running="false"] .skp-pomodoro-clock { color: var(--dsw-alias-label-secondary); }
.skp-pomodoro-rounds { font-variant-numeric: tabular-nums; }
.skp-pomodoro-sep { width: 1px; height: 14px; background: var(--dsw-alias-border-l1); }
.skp-pomodoro-actions { display: inline-flex; align-items: center; gap: 2px; }
.skp-pomodoro-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 6px; background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.skp-pomodoro-btn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.skp-pomodoro-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.skp-pomodoro-btn[data-primary="true"] { color: var(--dsw-alias-brand-primary); }
`

/** Style sheet for the settings page. */
export const SETTINGS_CSS = `
.skp-pomodoro-settings { display: flex; flex-direction: column; gap: 18px; padding: 2px 0 28px; max-width: 640px; }
.skp-pomodoro-settings h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.skp-pomodoro-settings p.skp-pomodoro-sub { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.skp-pomodoro-group { display: flex; flex-direction: column; }
.skp-pomodoro-group > h3 {
  margin: 0 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--dsw-alias-label-secondary);
}
.skp-pomodoro-rows {
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.skp-pomodoro-row {
  display: flex; align-items: center; gap: 16px;
  padding: 10px 14px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.skp-pomodoro-row:first-child { border-top: 0; }
.skp-pomodoro-rowtext { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.skp-pomodoro-rowlabel { font-size: 13px; color: var(--dsw-alias-label-primary); }
.skp-pomodoro-rowhint { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
.skp-pomodoro-value { display: inline-flex; align-items: center; gap: 6px; flex: none; }
.skp-pomodoro-number {
  width: 64px; height: 26px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); font-size: 12px; text-align: right;
}
.skp-pomodoro-number:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.skp-pomodoro-unit { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.skp-pomodoro-switch {
  position: relative; flex: none;
  width: 34px; height: 20px; padding: 0;
  border: 0; border-radius: 999px; background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.skp-pomodoro-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
.skp-pomodoro-switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.skp-pomodoro-knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--dsw-alias-label-primary);
  transition: transform 120ms ease;
}
.skp-pomodoro-switch[aria-checked="true"] .skp-pomodoro-knob { transform: translateX(14px); }
.skp-pomodoro-stats { display: flex; align-items: center; gap: 28px; }
.skp-pomodoro-stat { display: flex; flex-direction: column; gap: 2px; }
.skp-pomodoro-statvalue { font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.skp-pomodoro-statlabel { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.skp-pomodoro-ghost {
  margin-left: auto; height: 26px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; cursor: pointer;
}
.skp-pomodoro-ghost:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.skp-pomodoro-ghost:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`

/** Subscribe a component to the runtime's snapshot. */
function useSnapshot(runtime: PomodoroRuntime): PomodoroSnapshot {
  const [snapshot, setSnapshot] = useState<PomodoroSnapshot>(() => runtime.snapshot())
  useEffect(() => runtime.subscribe(() => setSnapshot(runtime.snapshot())), [runtime])
  return snapshot
}

/** One inline icon drawn in `currentColor` at a 16px box. */
function icon(path: ReactNode): ReactElement {
  return h(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: 14,
      height: 14,
      fill: 'currentColor',
      'aria-hidden': true,
      focusable: false,
    },
    path,
  )
}

/** Play triangle. */
const PLAY_ICON = icon(h('path', { d: 'M8 5.5v13l11-6.5z' }))
/** Pause bars. */
const PAUSE_ICON = icon([
  h('rect', { key: 'a', x: 7, y: 5.5, width: 3.5, height: 13, rx: 1 }),
  h('rect', { key: 'b', x: 13.5, y: 5.5, width: 3.5, height: 13, rx: 1 }),
])
/** Circular restart arrow. */
const RESET_ICON = icon(
  h('path', {
    d: 'M12 5.5a6.5 6.5 0 1 0 6.2 4.6l1.9-.5A8.5 8.5 0 1 1 12 3.5v2zM12 3.5 8.6 7 12 10.5z',
  }),
)
/** Skip-forward marker. */
const SKIP_ICON = icon([
  h('path', { key: 'a', d: 'M6 6l8 6-8 6z' }),
  h('rect', { key: 'b', x: 15.5, y: 6, width: 2.5, height: 12, rx: 1 }),
])

/** Localized phase name key for one phase. */
function phaseKey(phase: PhaseKind): 'dock.phase.work' | 'dock.phase.short-break' | 'dock.phase.long-break' {
  switch (phase) {
    case 'work':
      return 'dock.phase.work'
    case 'short-break':
      return 'dock.phase.short-break'
    case 'long-break':
      return 'dock.phase.long-break'
  }
}

/** One icon button with an accessible name. */
function IconButton(options: {
  readonly label: string
  readonly primary?: boolean
  readonly onClick: () => void
  readonly children?: ReactNode
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'skp-pomodoro-btn',
      title: options.label,
      'aria-label': options.label,
      ...(options.primary === true ? { 'data-primary': 'true' } : {}),
      onClick: options.onClick,
    },
    options.children,
  )
}

/**
 * The ambient clock shown under the composer.
 *
 * Everything it needs is the runtime, so it renders in any session without
 * reading Session or Conversation state.
 */
export function createDockClock(runtime: PomodoroRuntime): () => ReactElement {
  return function DockClock(): ReactElement {
    const { state, config, remainingMs, phaseDurationMs } = useSnapshot(runtime)
    const t = runtime.translate
    const phaseLabel = t(phaseKey(state.phase))
    const roundsInCycle = cyclePosition(state, config)
    const untouched = !state.running && state.remainingMs === phaseDurationMs
    const actionLabel = state.running ? t('dock.pause') : untouched ? t('dock.start') : t('dock.resume')

    return h(
      'div',
      { className: 'skp-pomodoro-dock' },
      h('style', { key: 'style' }, DOCK_CSS),
      h(
        'div',
        {
          key: 'pill',
          className: 'skp-pomodoro-pill',
          'data-phase': state.phase,
          'data-running': state.running ? 'true' : 'false',
        },
        h('span', { key: 'dot', className: 'skp-pomodoro-dot', 'aria-hidden': true }),
        h('span', { key: 'phase', className: 'skp-pomodoro-phase' }, phaseLabel),
        h(
          'span',
          {
            key: 'clock',
            className: 'skp-pomodoro-clock',
            role: 'timer',
            'aria-live': 'off',
            title: `${t('dock.today')}: ${String(focusMinutes(state.focusMs))} ${t('settings.unit.minutesShort')}`,
          },
          formatClock(remainingMs),
        ),
        h(
          'span',
          {
            key: 'rounds',
            className: 'skp-pomodoro-rounds',
            title: t('dock.rounds'),
          },
          `${String(roundsInCycle)}/${String(config.roundsBeforeLongBreak)}`,
        ),
        h('span', { key: 'sep', className: 'skp-pomodoro-sep', 'aria-hidden': true }),
        h(
          'span',
          { key: 'actions', className: 'skp-pomodoro-actions' },
          h(
            IconButton,
            {
              key: 'toggle',
              label: actionLabel,
              primary: !state.running,
              onClick: () => {
                runtime.toggle()
              },
            },
            state.running ? PAUSE_ICON : PLAY_ICON,
          ),
          h(
            IconButton,
            {
              key: 'reset',
              label: t('dock.reset'),
              onClick: () => {
                runtime.reset()
              },
            },
            RESET_ICON,
          ),
          h(
            IconButton,
            {
              key: 'skip',
              label: t('dock.skip'),
              onClick: () => {
                runtime.skip()
              },
            },
            SKIP_ICON,
          ),
        ),
      ),
    )
  }
}

/** One labelled preference row. */
function Row(options: {
  readonly label: string
  readonly hint: string
  readonly control: ReactNode
}): ReactElement {
  return h(
    'div',
    { className: 'skp-pomodoro-row' },
    h(
      'div',
      { className: 'skp-pomodoro-rowtext' },
      h('span', { className: 'skp-pomodoro-rowlabel' }, options.label),
      h('span', { className: 'skp-pomodoro-rowhint' }, options.hint),
    ),
    options.control,
  )
}

/** A minute field that commits a clamped value on blur or Enter. */
function NumberField(options: {
  readonly value: number
  readonly min: number
  readonly max: number
  readonly unit: string
  readonly label: string
  readonly onCommit: (value: number) => void
}): ReactElement {
  const [draft, setDraft] = useState(String(options.value))
  useEffect(() => {
    setDraft(String(options.value))
  }, [options.value])

  const commit = (): void => {
    const parsed = Number.parseInt(draft, 10)
    const next = Number.isFinite(parsed)
      ? Math.min(options.max, Math.max(options.min, parsed))
      : options.value
    setDraft(String(next))
    if (next !== options.value) options.onCommit(next)
  }

  return h(
    'span',
    { className: 'skp-pomodoro-value' },
    h('input', {
      type: 'number',
      className: 'skp-pomodoro-number',
      value: draft,
      min: options.min,
      max: options.max,
      step: 1,
      'aria-label': options.label,
      onChange: (event: { target: { value: string } }) => {
        setDraft(event.target.value)
      },
      onBlur: commit,
      onKeyDown: (event: { key: string }) => {
        if (event.key === 'Enter') commit()
      },
    }),
    h('span', { className: 'skp-pomodoro-unit' }, options.unit),
  )
}

/** An accessible on/off switch. */
function Switch(options: {
  readonly checked: boolean
  readonly label: string
  readonly onChange: (checked: boolean) => void
}): ReactElement {
  return h(
    'button',
    {
      type: 'button',
      className: 'skp-pomodoro-switch',
      role: 'switch',
      'aria-checked': options.checked,
      'aria-label': options.label,
      onClick: () => {
        options.onChange(!options.checked)
      },
    },
    h('span', { className: 'skp-pomodoro-knob' }),
  )
}

/** One titled group of rows. */
function Group(options: { readonly title: string; readonly children?: ReactNode }): ReactElement {
  return h(
    'section',
    { className: 'skp-pomodoro-group' },
    h('h3', {}, options.title),
    h('div', { className: 'skp-pomodoro-rows' }, options.children),
  )
}

/** The Pomodoro page inside Settings. */
export function createSettingsSection(runtime: PomodoroRuntime): () => ReactElement {
  return function PomodoroSettings(): ReactElement {
    const { state, config } = useSnapshot(runtime)
    const t = runtime.translate

    return h(
      'div',
      { className: 'skp-pomodoro-settings' },
      h('style', { key: 'style' }, SETTINGS_CSS),
      h(
        'header',
        { key: 'head' },
        h('h2', {}, t('settings.title')),
        h('p', { className: 'skp-pomodoro-sub' }, t('settings.description')),
      ),
      h(
        Group,
        { key: 'timers', title: t('settings.timers') },
        h(Row, {
          key: 'work',
          label: t('settings.work'),
          hint: t('settings.workHint'),
          control: h(NumberField, {
            value: config.workMinutes,
            min: LIMITS.minMinutes,
            max: LIMITS.maxMinutes,
            unit: t('settings.unit.minutes'),
            label: t('settings.work'),
            onCommit: (value: number) => {
              runtime.updateConfig({ workMinutes: value })
            },
          }),
        }),
        h(Row, {
          key: 'short',
          label: t('settings.shortBreak'),
          hint: t('settings.shortBreakHint'),
          control: h(NumberField, {
            value: config.shortBreakMinutes,
            min: LIMITS.minMinutes,
            max: LIMITS.maxMinutes,
            unit: t('settings.unit.minutes'),
            label: t('settings.shortBreak'),
            onCommit: (value: number) => {
              runtime.updateConfig({ shortBreakMinutes: value })
            },
          }),
        }),
        h(Row, {
          key: 'long',
          label: t('settings.longBreak'),
          hint: t('settings.longBreakHint'),
          control: h(NumberField, {
            value: config.longBreakMinutes,
            min: LIMITS.minMinutes,
            max: LIMITS.maxMinutes,
            unit: t('settings.unit.minutes'),
            label: t('settings.longBreak'),
            onCommit: (value: number) => {
              runtime.updateConfig({ longBreakMinutes: value })
            },
          }),
        }),
      ),
      h(
        Group,
        { key: 'cycle', title: t('settings.cycle') },
        h(Row, {
          key: 'rounds',
          label: t('settings.rounds'),
          hint: t('settings.roundsHint'),
          control: h(NumberField, {
            value: config.roundsBeforeLongBreak,
            min: LIMITS.minRounds,
            max: LIMITS.maxRounds,
            unit: t('settings.unit.rounds'),
            label: t('settings.rounds'),
            onCommit: (value: number) => {
              runtime.updateConfig({ roundsBeforeLongBreak: value })
            },
          }),
        }),
      ),
      h(
        Group,
        { key: 'automation', title: t('settings.automation') },
        h(Row, {
          key: 'breaks',
          label: t('settings.autoStartBreaks'),
          hint: t('settings.autoStartBreaksHint'),
          control: h(Switch, {
            checked: config.autoStartBreaks,
            label: t('settings.autoStartBreaks'),
            onChange: (checked: boolean) => {
              runtime.updateConfig({ autoStartBreaks: checked })
            },
          }),
        }),
        h(Row, {
          key: 'work',
          label: t('settings.autoStartWork'),
          hint: t('settings.autoStartWorkHint'),
          control: h(Switch, {
            checked: config.autoStartWork,
            label: t('settings.autoStartWork'),
            onChange: (checked: boolean) => {
              runtime.updateConfig({ autoStartWork: checked })
            },
          }),
        }),
      ),
      h(
        'section',
        { key: 'today', className: 'skp-pomodoro-group' },
        h('h3', {}, t('settings.today')),
        h(
          'div',
          { className: 'skp-pomodoro-stats' },
          h(
            'span',
            { className: 'skp-pomodoro-stat' },
            h('span', { className: 'skp-pomodoro-statvalue' }, String(state.rounds)),
            h('span', { className: 'skp-pomodoro-statlabel' }, t('settings.todayRounds')),
          ),
          h(
            'span',
            { className: 'skp-pomodoro-stat' },
            h(
              'span',
              { className: 'skp-pomodoro-statvalue' },
              `${String(focusMinutes(state.focusMs))} ${t('settings.unit.minutesShort')}`,
            ),
            h('span', { className: 'skp-pomodoro-statlabel' }, t('settings.todayFocus')),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'skp-pomodoro-ghost',
              onClick: () => {
                runtime.resetToday()
              },
            },
            t('settings.todayReset'),
          ),
        ),
      ),
    )
  }
}
