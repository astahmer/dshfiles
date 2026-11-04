import { defineLocale } from '@dshfiles/dshx/client'

const THREAD_TRANSFER_LOCALE_NAMESPACE = 'dshfiles.threadTransfer'

const en = {
  exportAction: 'Export…',
  exportPalette: 'Export this thread…',
  importPalette: 'Import thread…',
  exportTitle: 'Export thread',
  exportDescription:
    'Saves every message, tool call and result, attachment, the title and the model in one .dshthread file. Another DSH imports it as a new thread; it needs none of this machine’s folders or credentials.',
  exportPreparing: 'Preparing the bundle…',
  exportReady: 'Saved {file}',
  exportStats: '{messages} messages · {events} events · {attachments}',
  attachmentsNone: 'no attachments',
  attachmentsSome: '{count} attachments ({size})',
  exportMissing: '{count} attachments could not be read on this machine and were left out.',
  exportAgain: 'Export again',
  importTitle: 'Import thread',
  importDescription: 'Pick a .dshthread file exported from DSH. It becomes a new thread here; the original stays untouched.',
  importPick: 'Choose a .dshthread file',
  importUploading: 'Reading the bundle…',
  importModel: 'Model {model}',
  importFolderHint: 'Exported from a folder named {folder}',
  importDestination: 'Run it in',
  importHome: 'Home folder',
  importOtherFolder: 'Another folder…',
  importFolderPath: 'Absolute folder path',
  importSubmit: 'Import',
  importing: 'Importing…',
  imported: 'Imported “{title}”.',
  importOpen: 'Open thread',
  untitled: 'Untitled thread',
  close: 'Close',
  cancel: 'Cancel',
  failed: '{message}',
}

const zh = {
  exportAction: '导出…',
  exportPalette: '导出此对话…',
  importPalette: '导入对话…',
  exportTitle: '导出对话',
  exportDescription: '将所有消息、工具调用与结果、附件、标题和模型保存为一个 .dshthread 文件。另一台 DSH 可将其导入为新对话，无需本机的文件夹或凭据。',
  exportPreparing: '正在准备文件…',
  exportReady: '已保存 {file}',
  exportStats: '{messages} 条消息 · {events} 个事件 · {attachments}',
  attachmentsNone: '无附件',
  attachmentsSome: '{count} 个附件（{size}）',
  exportMissing: '{count} 个附件在本机无法读取，已省略。',
  exportAgain: '重新导出',
  importTitle: '导入对话',
  importDescription: '选择由 DSH 导出的 .dshthread 文件。它会成为这里的新对话；原对话保持不变。',
  importPick: '选择 .dshthread 文件',
  importUploading: '正在读取文件…',
  importModel: '模型 {model}',
  importFolderHint: '导出自名为 {folder} 的文件夹',
  importDestination: '运行位置',
  importHome: '主文件夹',
  importOtherFolder: '其他文件夹…',
  importFolderPath: '文件夹绝对路径',
  importSubmit: '导入',
  importing: '正在导入…',
  imported: '已导入“{title}”。',
  importOpen: '打开对话',
  untitled: '未命名对话',
  close: '关闭',
  cancel: '取消',
  failed: '{message}',
}

export type ThreadTransferKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.threadTransfer': ThreadTransferKey
  }
}

export const threadTransferLocale = defineLocale(THREAD_TRANSFER_LOCALE_NAMESPACE, { en, zh })
export const THREAD_TRANSFER_LOCALE = THREAD_TRANSFER_LOCALE_NAMESPACE
