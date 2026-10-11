import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const ACTIVITY_TIMELINE_LOCALE_NAMESPACE = 'dshfiles.activityTimeline'

const en = {
  title: 'Activity',
  subtitle: 'One chronological feed across agents, communication, and jj integration. Observation only.',
  connected: 'Host connected',
  unavailable: 'Host unavailable',
  loading: 'Loading…',
  loadFailed: 'Activity could not be loaded.',
  refresh: 'Refresh',
  search: 'Search activity',
  searchPlaceholder: 'Search type, summary, or detail…',
  filters: 'Filters',
  allSources: 'All sources',
  session: 'Agent',
  communication: 'Communication',
  integration: 'Integration',
  system: 'System',
  attentionOnly: 'Attention only',
  detailed: 'Detailed (no condensation)',
  loadOlder: 'Load older',
  loadingOlder: 'Loading older…',
  noActivity: 'No activity yet.',
  noMatch: 'No activity matches this filter.',
  newEvents: 'New events',
  jumpToLatest: 'Jump to latest',
  retained: 'retained',
  attention: 'attention',
  duplicates: 'duplicates',
  detail: 'Event detail',
  related: 'Related events',
  references: 'References',
  metadata: 'Metadata',
  provenance: 'Provenance',
  observed: 'Observed',
  reported: 'Reported',
  close: 'Close',
  groupMembers: 'Grouped events',
  events: 'events',
  routineHidden: 'Routine events are condensed; switch on Detailed to inspect every retained event.',
  emptyDetail: 'Select an event to inspect its metadata and correlated activity.',
} as const

const zh = {
  title: '活动',
  subtitle: '跨 Agent、通信与 jj 集成的单一时间线。仅用于观察。',
  connected: 'Host 已连接',
  unavailable: 'Host 不可用',
  loading: '正在加载…',
  loadFailed: '无法加载活动。',
  refresh: '刷新',
  search: '搜索活动',
  searchPlaceholder: '搜索类型、摘要或详情…',
  filters: '筛选',
  allSources: '全部来源',
  session: 'Agent',
  communication: '通信',
  integration: '集成',
  system: '系统',
  attentionOnly: '仅需关注',
  detailed: '详细（不压缩）',
  loadOlder: '加载更早',
  loadingOlder: '正在加载更早…',
  noActivity: '暂无活动。',
  noMatch: '没有匹配的活动。',
  newEvents: '新事件',
  jumpToLatest: '跳到最新',
  retained: '已保留',
  attention: '需关注',
  duplicates: '重复',
  detail: '事件详情',
  related: '相关事件',
  references: '引用',
  metadata: '元数据',
  provenance: '来源性质',
  observed: '直接观察',
  reported: '上报',
  close: '关闭',
  groupMembers: '分组事件',
  events: '个事件',
  routineHidden: '常规事件已压缩；开启“详细”可查看全部保留事件。',
  emptyDetail: '选择一个事件以查看其元数据与相关活动。',
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.activityTimeline': keyof typeof en
  }
}

export type ActivityTimelineTranslate = TranslateNS<typeof ACTIVITY_TIMELINE_LOCALE_NAMESPACE>

export const activityTimelineLocale = defineLocale(ACTIVITY_TIMELINE_LOCALE_NAMESPACE, { en, zh })
