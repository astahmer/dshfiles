import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

const en = {
  title: 'Notifications',
  subtitle: 'Last 500 thread events, including while alerts are off. Read status here does not change thread attention.',
  all: 'History',
  unread: 'Unread',
  read: 'Read',
  dismissed: 'Dismissed',
  empty: 'No notifications here. New thread events appear automatically.',
  loading: 'Loading notification history…',
  unavailable: 'History unavailable. Retry after the Host connects. If this follows an update, restart DSH when your running work is finished.',
  retry: 'Retry',
  refresh: 'Refresh',
  markRead: 'Mark read',
  markUnread: 'Mark unread',
  markAllRead: 'Mark all read',
  dismiss: 'Dismiss',
  restore: 'Restore',
  openThread: 'Open thread',
  restoreThread: 'Restore and open thread',
  missingThread: 'Thread unavailable',
  missingHint: 'This thread is no longer available. Keep this notification or dismiss it.',
  clear: 'Clear history',
  clearTitle: 'Clear notification history?',
  clearDescription:
    'Permanently delete the retained entries shown when this dialog opened, including dismissed entries. New arrivals are kept. Threads and conversations are not deleted.',
  cancel: 'Cancel',
  actionFailed: 'Change not saved. Retry the action; refresh if another tab changed this history.',
  'approval-needed': 'Approval requested',
  'input-needed': 'Input requested',
  'turn-finished': 'Turn finished',
  stopped: 'Turn stopped',
  failed: 'Turn failed',
} as const

const zh = {
  title: '通知',
  subtitle: '最近 500 条线程事件，提醒关闭时仍会记录。此处的已读状态不影响线程待处理状态。',
  all: '历史',
  unread: '未读',
  read: '已读',
  dismissed: '已忽略',
  empty: '暂无通知。新的线程事件将自动显示。',
  loading: '正在加载通知历史…',
  unavailable: '历史暂不可用。Host 连接后重试；若刚更新，请在运行中的工作结束后重启 DSH。',
  retry: '重试',
  refresh: '刷新',
  markRead: '标为已读',
  markUnread: '标为未读',
  markAllRead: '全部标为已读',
  dismiss: '忽略',
  restore: '恢复',
  openThread: '打开线程',
  restoreThread: '恢复并打开线程',
  missingThread: '线程不可用',
  missingHint: '此线程已不可用。可保留或忽略这条通知。',
  clear: '清空历史',
  clearTitle: '清空通知历史？',
  clearDescription: '永久删除打开此对话框时保留的通知，包括已忽略的通知。新通知会保留。不会删除线程或对话。',
  cancel: '取消',
  actionFailed: '更改未保存。请重试；若其他标签页更改了历史，请刷新。',
  'approval-needed': '请求批准',
  'input-needed': '请求输入',
  'turn-finished': '轮次已完成',
  stopped: '轮次已停止',
  failed: '轮次失败',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.notificationHistory': keyof typeof en
  }
}

export type NotificationHistoryTranslate = TranslateNS<'dshfiles.notificationHistory'>
export const notificationHistoryLocale = defineLocale('dshfiles.notificationHistory', { en, zh })
