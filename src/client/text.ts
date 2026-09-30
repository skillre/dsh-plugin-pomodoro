/**
 * Text catalogue for the Pomodoro plugin.
 *
 * Every visible string lives here and reaches the UI through the Client locale
 * service, so the plugin follows the active language with no re-registration.
 * `EN` is the reference dictionary: its keys define the text union and every
 * other language must cover all of them.
 */

/** English reference dictionary. */
export const EN = {
  'dock.phase.work': 'Focus',
  'dock.phase.short-break': 'Short break',
  'dock.phase.long-break': 'Long break',
  'dock.start': 'Start focus',
  'dock.resume': 'Resume',
  'dock.pause': 'Pause',
  'dock.reset': 'Restart this phase',
  'dock.skip': 'Skip to the next phase',
  'dock.rounds': 'Focus rounds in this cycle',
  'dock.today': 'Focused today',
  'settings.nav': 'Pomodoro',
  'settings.title': 'Pomodoro',
  'settings.description': 'A focus clock that runs beside the composer and keeps your daily rounds.',
  'settings.timers': 'Timers',
  'settings.work': 'Focus length',
  'settings.workHint': 'Minutes of one focus round.',
  'settings.shortBreak': 'Short break',
  'settings.shortBreakHint': 'Break after a regular focus round.',
  'settings.longBreak': 'Long break',
  'settings.longBreakHint': 'Break after a full cycle of focus rounds.',
  'settings.cycle': 'Cycle',
  'settings.rounds': 'Rounds before a long break',
  'settings.roundsHint': 'How many focus rounds a cycle holds.',
  'settings.automation': 'Automation',
  'settings.autoStartBreaks': 'Start breaks automatically',
  'settings.autoStartBreaksHint': 'A finished focus round flows straight into its break.',
  'settings.autoStartWork': 'Start focus automatically',
  'settings.autoStartWorkHint': 'A finished break flows straight into the next focus round.',
  'settings.today': 'Today',
  'settings.todayRounds': 'Completed rounds',
  'settings.todayFocus': 'Focus time',
  'settings.todayReset': 'Reset today',
  'settings.unit.minutes': 'min',
  'settings.unit.rounds': 'rounds',
  'settings.unit.minutesShort': 'min',
} as const

/** Every text key this plugin can display. */
export type PomodoroTextKey = keyof typeof EN

/** Chinese dictionary; keys must match {@link EN} exactly. */
export const ZH: Record<PomodoroTextKey, string> = {
  'dock.phase.work': '专注',
  'dock.phase.short-break': '短休息',
  'dock.phase.long-break': '长休息',
  'dock.start': '开始专注',
  'dock.resume': '继续',
  'dock.pause': '暂停',
  'dock.reset': '重新计时',
  'dock.skip': '跳到下一阶段',
  'dock.rounds': '本轮已完成的专注次数',
  'dock.today': '今日专注',
  'settings.nav': '番茄时钟',
  'settings.title': '番茄时钟',
  'settings.description': '在输入框旁运行的专注计时器，并记录你每天的番茄数。',
  'settings.timers': '时长',
  'settings.work': '专注时长',
  'settings.workHint': '每一轮专注的分钟数。',
  'settings.shortBreak': '短休息',
  'settings.shortBreakHint': '普通专注轮次之后的休息。',
  'settings.longBreak': '长休息',
  'settings.longBreakHint': '完成一整轮专注循环之后的休息。',
  'settings.cycle': '循环',
  'settings.rounds': '长休息前的专注轮数',
  'settings.roundsHint': '一个循环包含几轮专注。',
  'settings.automation': '自动化',
  'settings.autoStartBreaks': '自动开始休息',
  'settings.autoStartBreaksHint': '专注结束后直接进入休息。',
  'settings.autoStartWork': '自动开始专注',
  'settings.autoStartWorkHint': '休息结束后直接进入下一轮专注。',
  'settings.today': '今日',
  'settings.todayRounds': '完成轮数',
  'settings.todayFocus': '专注时长',
  'settings.todayReset': '重置今日',
  'settings.unit.minutes': '分钟',
  'settings.unit.rounds': '轮',
  'settings.unit.minutesShort': '分钟',
}

/** A locale dictionary as the Client locale service accepts it. */
export type PomodoroDict = Record<PomodoroTextKey, string>

/** The locale namespace this plugin registers its dictionaries under. */
export const NAMESPACE = 'skillre-pomodoro'

/** Locale id prefix routed to the Chinese dictionary. */
const CHINESE_PREFIX = 'zh'

/** Dictionary for one locale id, falling back to English. */
export function dictFor(localeId: string): PomodoroDict {
  return localeId.toLowerCase().startsWith(CHINESE_PREFIX) ? ZH : EN
}
