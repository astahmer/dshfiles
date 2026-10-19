import { defineLocale } from '@dshfiles/dshx/client'

export const MENTIONS_LOCALE_NAMESPACE = 'dshfiles.mentions'

const en = {
  'scope.all': 'Threads & files · @t: threads · @f: files · @skill: · @mcp: · @b: backlog',
  'scope.thread': 'Threads · @f: files',
  'scope.file': 'Files · @t: threads',
  subagent: 'subagent',
  noCwd: '(no cwd)',
  crumbRoot: 'Workspace',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
} as const

const zh = {
  'scope.all': '对话与文件 · @t: 对话 · @f: 文件 · @skill: · @mcp: · @b: 待办',
  'scope.thread': '对话 · @f: 文件',
  'scope.file': '文件 · @t: 对话',
  subagent: '子智能体',
  noCwd: '（无工作目录）',
  crumbRoot: '工作区',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.mentions': keyof typeof en
  }
}

export const mentionsLocale = defineLocale(MENTIONS_LOCALE_NAMESPACE, { en, zh })
