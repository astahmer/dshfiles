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
  waitingForJobOutput: 'Waiting for job output',
  waitingForAllJobs: 'Waiting for all running background jobs to settle',
  waitingForJob: 'Waiting for 1 background job to finish',
  waitingForJobs: 'Waiting for {count} background jobs to finish',
  waitingForAnyJobs: 'Waiting for any of {count} background jobs to finish',
  waitRemaining: '{duration} until wait timeout',
  waitProgress: 'Wait timeout countdown: {remaining} remaining of {timeout}',
  riskHigh: 'Destructive',
  riskReview: 'Review',
  riskLow: 'Read-only',
  approvalDetails: 'Approval details: Enter allows once, Escape rejects',
  approvalReject: 'Reject',
  approvalAllowOnce: 'Allow once',
  approvalFailed: 'The decision did not reach the agent. Try again, or reject and ask the agent to retry.',
  approvalReason: '{tool} asks to run with more access',
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
  waitingForJobOutput: '正在等待任务输出',
  waitingForAllJobs: '正在等待所有运行中的后台任务结束',
  waitingForJob: '正在等待 1 个后台任务结束',
  waitingForJobs: '正在等待 {count} 个后台任务结束',
  waitingForAnyJobs: '正在等待任意一个后台任务结束（共 {count} 个）',
  waitRemaining: '等待超时还有 {duration}',
  waitProgress: '等待超时倒计时：还剩 {remaining}，共 {timeout}',
  riskHigh: '破坏性',
  riskReview: '需审查',
  riskLow: '只读',
  approvalDetails: '审批详情：Enter 允许一次，Escape 拒绝',
  approvalReject: '拒绝',
  approvalAllowOnce: '允许一次',
  approvalFailed: '决定未送达智能体。请重试，或拒绝后让智能体重新尝试。',
  approvalReason: '{tool} 请求以更高权限运行',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.tool-meta': keyof typeof en
  }
}

export type ToolMetaTranslate = TranslateNS<typeof TOOL_META_LOCALE_NAMESPACE>

export const toolMetaLocale = defineLocale(TOOL_META_LOCALE_NAMESPACE, { en, zh })
