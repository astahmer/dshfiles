import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const TOOL_META_LOCALE_NAMESPACE = 'dshfiles.tool-meta'

const en = {
  seconds: '{n} s',
  minutes: '{m} min {s} s',
  hours: '{h} h {m} min',
  secondsAgo: '{n} s ago',
  minutesAgo: '{n} min ago',
  hoursAgo: '{n} h ago',
  daysAgo: '{n} d ago',
  ended: 'ended {end}',
  runningLabel: 'Running for {duration}, started {start}',
  finishedLabel: 'Took {duration}, started {start}',
  endedLabel: 'Finished {end}; its start is outside the loaded history',
  waitElapsed: 'Waiting for {duration}',
  waitRemaining: '{duration} until wait timeout',
  waitProgress: 'Wait timeout countdown: {remaining} remaining of {timeout}',
}

const zh = {
  seconds: '{n} 秒',
  minutes: '{m} 分 {s} 秒',
  hours: '{h} 小时 {m} 分',
  secondsAgo: '{n} 秒前',
  minutesAgo: '{n} 分钟前',
  hoursAgo: '{n} 小时前',
  daysAgo: '{n} 天前',
  ended: '结束于 {end}',
  runningLabel: '已运行 {duration}，开始于 {start}',
  finishedLabel: '用时 {duration}，开始于 {start}',
  endedLabel: '结束于 {end}；开始时间不在已加载的历史中',
  waitElapsed: '已等待 {duration}',
  waitRemaining: '等待超时还有 {duration}',
  waitProgress: '等待超时倒计时：还剩 {remaining}，共 {timeout}',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.tool-meta': keyof typeof en
  }
}

export type ToolMetaTranslate = TranslateNS<typeof TOOL_META_LOCALE_NAMESPACE>

export const toolMetaLocale = defineLocale(TOOL_META_LOCALE_NAMESPACE, { en, zh })
