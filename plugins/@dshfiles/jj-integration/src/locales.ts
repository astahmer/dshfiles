import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const JJ_INTEGRATION_LOCALE_NAMESPACE = 'dshfiles.jjIntegration'

const en = {
  title: 'Thread workspaces',
  subtitle: 'Each new thread works in its own jj workspace. Land rebases its work onto {bookmark} and moves the bookmark.',
  refresh: 'Refresh',
  loadFailed: 'Thread workspaces could not be loaded.',
  noRepositories: 'No registered project is a jj repository.',
  noThreads: 'No thread workspaces.',
  land: 'Land',
  landing: 'Landing…',
  discard: 'Discard',
  discardWork: 'Discard with work',
  unlanded: '{count} unlanded',
  upToDate: 'Nothing to land',
  behind: 'Behind {bookmark}',
  conflict: 'Conflict',
  finished: 'Archived',
  missing: 'Directory missing',
  sessions: '{count} thread(s)',
  landed: 'Landed {count} revision(s) onto {bookmark}.',
  nothingToLand: 'Nothing to land; the workspace now sits on {bookmark}.',
  needsDescription: 'Describe these revisions before landing: {revisions}.',
  conflicted: 'Rebasing onto {bookmark} left conflicts in {files}.',
  agentAsked: 'Asked the thread’s agent to fix it and land again.',
  hasWork: 'This workspace has unlanded work. Use “Discard with work” to delete it anyway.',
  landThread: 'Land this thread onto {bookmark}',
  destination: 'New thread destination',
  hostLocal: 'Local',
  hostPlanned: 'This machine. Other hosts are planned: plans/thread-destination-host.',
  noFolder: 'No folder',
  recent: 'Recent',
  openFolder: 'Open folder…',
  bookmarkIsolates: 'Picking a bookmark starts this thread in its own workspace at that bookmark.',
  searchBookmarks: 'Search bookmarks…',
  noBookmarks: 'No bookmark matches.',
  isolateHint: 'Work in a separate jj workspace, so other threads never see this one’s edits until it lands.',
  workspace: 'workspace',
  chooseProject: 'Choose a project',
} as const

const zh: Record<keyof typeof en, string> = {
  title: '会话工作区',
  subtitle: '每个新会话在独立的 jj 工作区中工作。合入会把它的修改变基到 {bookmark} 并移动书签。',
  refresh: '刷新',
  loadFailed: '无法加载会话工作区。',
  noRepositories: '没有已注册的项目是 jj 仓库。',
  noThreads: '没有会话工作区。',
  land: '合入',
  landing: '合入中…',
  discard: '丢弃',
  discardWork: '连同修改一起丢弃',
  unlanded: '{count} 个未合入',
  upToDate: '没有可合入的内容',
  behind: '落后于 {bookmark}',
  conflict: '冲突',
  finished: '已归档',
  missing: '目录缺失',
  sessions: '{count} 个会话',
  landed: '已将 {count} 个修订合入 {bookmark}。',
  nothingToLand: '没有可合入的内容；工作区现在位于 {bookmark}。',
  needsDescription: '合入前请为这些修订添加描述：{revisions}。',
  conflicted: '变基到 {bookmark} 后以下文件有冲突：{files}。',
  agentAsked: '已请该会话的智能体修复并重新合入。',
  hasWork: '此工作区有未合入的修改。如仍要删除，请使用“连同修改一起丢弃”。',
  landThread: '将此会话合入 {bookmark}',
  destination: '新会话位置',
  hostLocal: '本机',
  hostPlanned: '本机。其他主机已在计划中：plans/thread-destination-host。',
  noFolder: '无文件夹',
  recent: '最近',
  openFolder: '打开文件夹…',
  bookmarkIsolates: '选择书签会在该书签处为此会话创建独立工作区。',
  searchBookmarks: '搜索书签…',
  noBookmarks: '没有匹配的书签。',
  isolateHint: '在独立的 jj 工作区中工作，合入前其他会话看不到这里的修改。',
  workspace: '工作区',
  chooseProject: '选择项目',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.jjIntegration': keyof typeof en
  }
}

export const jjIntegrationLocale = defineLocale(JJ_INTEGRATION_LOCALE_NAMESPACE, { en, zh })

export type JjIntegrationTranslate = TranslateNS<typeof JJ_INTEGRATION_LOCALE_NAMESPACE>
