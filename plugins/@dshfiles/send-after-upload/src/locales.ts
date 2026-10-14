import { defineLocale } from '@dshfiles/dshx/client'

export const SEND_AFTER_UPLOAD_LOCALE_NAMESPACE = 'dshfiles.sendAfterUpload'

const en = {
  waiting: 'Sending when upload finishes…',
  cancel: 'Cancel',
  'failed.upload': 'An upload failed, so the message was not sent.',
  'failed.timeout': 'The upload took too long, so the message was not sent.',
  'failed.send': 'The message could not be sent.',
  dismiss: 'Dismiss',
} as const

const zh = {
  waiting: '上传完成后发送…',
  cancel: '取消',
  'failed.upload': '有文件上传失败，消息未发送。',
  'failed.timeout': '上传超时，消息未发送。',
  'failed.send': '消息发送失败。',
  dismiss: '关闭',
} as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.sendAfterUpload': keyof typeof en
  }
}

export const sendAfterUploadLocale = defineLocale(SEND_AFTER_UPLOAD_LOCALE_NAMESPACE, { en, zh })
