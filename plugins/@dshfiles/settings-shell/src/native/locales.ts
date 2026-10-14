import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

/**
 * The ported shell's dictionary. The native `settings` namespace is reserved to the package this one replaces, and
 * nothing else reads it, so the same keys live under this plugin's own namespace.
 */
export const SHELL_LOCALE_NAMESPACE = 'dshfiles.settings-shell'

// Keys this plugin adds on top of the port.
const shellEn = {
  'view.expand': 'Expand to the full window',
  'view.restore': 'Restore the dialog size',
  'view.openInTab': 'Open in a tab',
  'palette.open': 'Open Settings',
  'palette.section': 'Settings: {section}',
}

const shellZh = {
  'view.expand': '展开到整个窗口',
  'view.restore': '恢复对话框大小',
  'view.openInTab': '在标签页中打开',
  'palette.open': '打开设置',
  'palette.section': '设置：{section}',
} satisfies Record<keyof typeof shellEn, string>

// Ported verbatim from @deepseek-ai/dsh-client-ui-settings-general@0.2.0-rc.2 (MIT), lib/client.js `zh` and `en`.
const zh = {
  trigger: '设置',
  'shortcut.open': '打开设置',
  'desktop.update.available': '新版本',
  'desktop.update.checking': '正在检查更新…',
  'desktop.update.progress': '{percent}%',
  'desktop.update.verifying': '正在校验更新文件…',
  'desktop.update.installing': '正在准备重启…',
  'desktop.update.ready': '安装并重启',
  'desktop.update.retry': '重试更新',
  'desktop.update.versionDetail': '{label}：{version}',
  'desktop.update.downloadDetail': '正在下载更新：{percent}%\n目标版本：{version}',
  'desktop.update.checkFailed': '检查更新失败，请稍后重试。',
  'desktop.update.downloadFailed': '下载更新失败，请重试。',
  'desktop.update.installFailed': '安装更新失败，请稍后重试。',
  'desktop.update.checkNetworkFailed': '检查更新失败，请检查网络连接后重试。',
  'desktop.update.downloadNetworkFailed': '下载更新失败，请检查网络连接后重试。',
  'desktop.update.installNetworkFailed': '安装更新失败，请检查网络连接后重试。',
  'desktop.update.stopFailed': '未能安全停止任务，更新尚未安装，请稍后重试。',
  'desktop.update.tasksChanged': '有新任务开始运行，请重新确认是否停止任务并更新。',
  'desktop.update.tasksUnavailable': '无法确认任务状态，请在工作区就绪后重试更新。',
  title: '设置',
  close: '关闭',
  openDocument: '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'general.currentVersion': '当前版本：{version}',
  'developerTools.title': '显示代码工作视图',
  'developerTools.error': '保存失败，请重试',
  'developerTools.description': '开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换',
  'connection.error': '连接异常，刷新重试',
  'connection.connecting': '重新连接中',
  'connection.connected': '连接成功',
  'connection.reconnect': '连接异常，点击立即重连',
  'connection.restart': '连接中断，正在重试，点击立即重连',
  ...shellZh,
}

const en = {
  trigger: 'Settings',
  'shortcut.open': 'Open settings',
  'desktop.update.available': 'Update',
  'desktop.update.checking': 'Checking for updates…',
  'desktop.update.progress': '{percent}%',
  'desktop.update.verifying': 'Verifying update files…',
  'desktop.update.installing': 'Preparing to restart…',
  'desktop.update.ready': 'Install and Restart',
  'desktop.update.retry': 'Retry update',
  'desktop.update.versionDetail': '{label}: {version}',
  'desktop.update.downloadDetail': 'Downloading update: {percent}%\nTarget version: {version}',
  'desktop.update.checkFailed': 'Could not check for updates. Please try again later.',
  'desktop.update.downloadFailed': 'Could not download the update. Please try again.',
  'desktop.update.installFailed': 'Could not install the update. Please try again later.',
  'desktop.update.checkNetworkFailed': 'Could not check for updates. Check your connection and try again.',
  'desktop.update.downloadNetworkFailed': 'Could not download the update. Check your connection and try again.',
  'desktop.update.installNetworkFailed': 'Could not install the update. Check your connection and try again.',
  'desktop.update.stopFailed': 'Could not safely stop the tasks. The update has not been installed. Please try again later.',
  'desktop.update.tasksChanged': 'New tasks have started. Confirm again to stop the tasks and update.',
  'desktop.update.tasksUnavailable': 'Task status is unavailable. Try updating again when the workspace is ready.',
  title: 'Settings',
  close: 'Close',
  openDocument: 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'general.currentVersion': 'Current version: {version}',
  'developerTools.title': 'Show coding view',
  'developerTools.error': 'Could not save. Please try again.',
  'developerTools.description': 'Shows trajectory, code diffs, and all Agent presets',
  'connection.error': 'Disconnected',
  'connection.connecting': 'Reconnecting',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Disconnected, reconnect now',
  'connection.restart': 'Reconnecting, reconnect now',
  ...shellEn,
} satisfies Record<keyof typeof zh, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.settings-shell': keyof typeof zh
  }
}

export type ShellTranslate = TranslateNS<typeof SHELL_LOCALE_NAMESPACE>

export const shellLocale = defineLocale(SHELL_LOCALE_NAMESPACE, { zh, en })
