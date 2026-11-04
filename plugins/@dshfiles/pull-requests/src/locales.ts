import { defineLocale } from '@dshfiles/dshx/client'

export const PULL_REQUESTS_LOCALE_NAMESPACE = 'dshfiles.pull-requests'

const en = {
  paletteCreate: 'Create pull request from this thread',
  title: 'Create pull request',
  description: 'From “{thread}”. Nothing is pushed until you confirm.',
  loading: 'Reading the workspace and drafting a title…',
  previewFailed: 'The preview could not be read: {reason}',
  retry: 'Try again',
  refresh: 'Refresh preview',
  cancel: 'Cancel',
  close: 'Close',
  create: 'Push and create pull request',
  linkExisting: 'Push and link existing pull request',
  creating: 'Pushing and creating…',
  commits: '{count} commit(s) to push',
  existing: 'An open pull request already uses this bookmark; confirming links it instead of opening another.',
  blocked: 'Fix these before creating the pull request:',
  draftNote: 'Drafted from the commit messages: {note}',
  generated: 'Drafted by {route} from this thread.',
  fieldTitle: 'Title',
  fieldBody: 'Description',
  fieldDraft: 'Open as a draft pull request',
  created: 'Opened {url}',
  linked: 'Linked {url}',
  watching: 'Linked to this thread and watched for CI, reviews and merges.',
  openOnGitHub: 'Open on GitHub',
  failed: 'Not created ({stage}): {message}',
  pushed: 'The branch was pushed.',
  noDescription: '(no description)',
} as const

const zh = {
  paletteCreate: '从此对话创建拉取请求',
  title: '创建拉取请求',
  description: '来自“{thread}”。确认之前不会推送任何内容。',
  loading: '正在读取工作区并起草标题…',
  previewFailed: '无法读取预览：{reason}',
  retry: '重试',
  refresh: '刷新预览',
  cancel: '取消',
  close: '关闭',
  create: '推送并创建拉取请求',
  linkExisting: '推送并关联已有拉取请求',
  creating: '正在推送并创建…',
  commits: '将推送 {count} 个提交',
  existing: '已有一个打开的拉取请求使用此书签；确认后将关联它，而不是新建。',
  blocked: '创建拉取请求前请先修复：',
  draftNote: '根据提交信息起草：{note}',
  generated: '由 {route} 根据此对话起草。',
  fieldTitle: '标题',
  fieldBody: '描述',
  fieldDraft: '以草稿拉取请求打开',
  created: '已打开 {url}',
  linked: '已关联 {url}',
  watching: '已关联到此对话，并监视 CI、评审和合并。',
  openOnGitHub: '在 GitHub 上打开',
  failed: '未创建（{stage}）：{message}',
  pushed: '分支已推送。',
  noDescription: '（无描述）',
} as const

export type PullRequestsKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.pull-requests': PullRequestsKey
  }
}

export const pullRequestsLocale = defineLocale(PULL_REQUESTS_LOCALE_NAMESPACE, { en, zh })
