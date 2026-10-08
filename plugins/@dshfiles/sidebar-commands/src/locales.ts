import { defineLocale } from '@dshfiles/dshx/client'

export const SIDEBAR_COMMANDS_LOCALE_NAMESPACE = 'dshfiles.sidebarCommands'

const en = {
  label: 'Go to',
  description: 'Open a sidebar panel or a recent session',
  searchPlaceholder: 'Search panels and sessions',
  searchEmpty: 'No panels or sessions are available yet.',
  searchNoResults: 'Nothing matches that search.',
  panelsGroup: 'Panels',
  sessionsGroup: 'Sessions',
  panelDetail: 'Panel',
  sessionDetail: 'Session',
  actionsGroup: 'Actions',
  actionDetail: 'Thread sidebar',
  paletteLabel: 'Open command palette',
  threadSearchLabel: 'Search threads',
  paletteUnavailable: 'The command palette is not loaded.',
  panelUnavailable: 'That panel is no longer registered.',
  sessionUnavailable: 'That session is no longer available.',
}

const zh = {
  label: '前往',
  description: '打开侧边栏面板或最近的会话',
  searchPlaceholder: '搜索面板和会话',
  searchEmpty: '暂无可用的面板或会话。',
  searchNoResults: '没有匹配的结果。',
  panelsGroup: '面板',
  sessionsGroup: '会话',
  panelDetail: '面板',
  sessionDetail: '会话',
  actionsGroup: '操作',
  actionDetail: '会话侧边栏',
  paletteLabel: '打开命令面板',
  threadSearchLabel: '搜索会话',
  paletteUnavailable: '命令面板未加载。',
  panelUnavailable: '该面板已不再注册。',
  sessionUnavailable: '该会话已不可用。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.sidebarCommands': keyof typeof en
  }
}

export type GoToCopy = Readonly<
  Record<'panelsGroup' | 'sessionsGroup' | 'panelDetail' | 'sessionDetail' | 'actionsGroup' | 'actionDetail' | 'paletteLabel' | 'threadSearchLabel', string>
>

export const sidebarCommandsLocale = defineLocale(SIDEBAR_COMMANDS_LOCALE_NAMESPACE, { en, zh })
