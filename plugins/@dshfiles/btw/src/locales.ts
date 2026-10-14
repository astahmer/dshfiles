import { defineLocale } from '@dshfiles/dshx/client'

export const BTW_LOCALE_NAMESPACE = 'dshfiles.btw'

const en = {
  description: 'Ask a side question about this thread without touching it',
  hint: 'Ask about this thread; the answer opens in a side panel',
  empty: 'Type a question after /btw.',
  thinking: 'Asking…',
  cache: '{share}% of the first request read from the prefix cache',
  cacheWaiting: 'Waiting for the first answer…',
  failed: 'Side chat failed: {reason}',
  dismiss: 'Dismiss',
} as const

const zh = {
  description: '就当前对话提一个旁支问题，不影响主对话',
  hint: '就当前对话提问；回答在侧边面板中打开',
  empty: '请在 /btw 后输入问题。',
  thinking: '提问中…',
  cache: '首个请求有 {share}% 命中前缀缓存',
  cacheWaiting: '等待首个回答…',
  failed: '旁支对话失败：{reason}',
  dismiss: '关闭',
} as const

export type BtwKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.btw': BtwKey
  }
}

export const btwLocale = defineLocale(BTW_LOCALE_NAMESPACE, { en, zh })
