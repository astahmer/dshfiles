import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const NETWORK_LOCALE_NAMESPACE = 'dshfiles.loopback-access'

export const networkEnglish = {
  networkAccess: 'Network access',
  description:
    'Choose how this DSH is reachable. Localhost access stays enabled. Saving stages preferences; it does not restart DSH or change the current connection.',
  lanEnabled: 'LAN access',
  lanHint: 'Allow other devices to connect through one specific local address.',
  bindAddress: 'LAN address',
  chooseAddress: 'Choose an interface and address',
  addressSearch: 'Search network addresses',
  noAddresses: 'No network addresses available',
  missingAddress: 'Unavailable saved address',
  advanced: 'Advanced',
  port: 'Port',
  portHint: '0 chooses an available port. Otherwise use 1–65535.',
  invalidPort: 'Enter a whole number from 0 to 65535.',
  addressRequired: 'Choose an available LAN address before saving.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Preferences saved. The current connection has not changed.',
  saveFailed: 'Could not save network preferences.',
  loading: 'Reading network access…',
  unavailable: 'Network settings are unavailable. Restart or update DSH to load the matching Host plugin.',
  retry: 'Try again',
  readOnly: 'Network preferences are read-only in this deployment.',
  unsupported: 'This launcher does not support managed network preferences.',
  setup: 'This profile has custom network configuration. Update its startup wiring and restart DSH to use these controls.',
  currentUrls: 'Current URLs',
  active: 'Saved preferences are loaded for this launch.',
  pendingRestart: 'Restart DSH to load the saved preferences.',
  cliOverride: 'Command-line overrides are active. Saved preferences will not replace these overrides.',
  hostOverride: 'Host override',
  portOverride: 'Port override',
  currentListener: 'Current listener',
} as const

const zh = {
  networkAccess: '网络访问',
  description: '选择如何访问此 DSH。本机访问始终保持启用。保存仅记录偏好设置，不会重启 DSH 或改变当前连接。',
  lanEnabled: '局域网访问',
  lanHint: '允许其他设备通过指定的本地地址连接。',
  bindAddress: '局域网地址',
  chooseAddress: '选择网络接口和地址',
  addressSearch: '搜索网络地址',
  noAddresses: '没有可用的网络地址',
  missingAddress: '已保存的地址不可用',
  advanced: '高级',
  port: '端口',
  portHint: '0 表示自动选择可用端口；否则请输入 1–65535。',
  invalidPort: '请输入 0 到 65535 之间的整数。',
  addressRequired: '保存前请选择可用的局域网地址。',
  save: '保存',
  saving: '正在保存…',
  saved: '偏好设置已保存。当前连接未改变。',
  saveFailed: '无法保存网络偏好设置。',
  loading: '正在读取网络访问设置…',
  unavailable: '网络设置不可用。请重启或更新 DSH 以加载匹配的 Host 插件。',
  retry: '重试',
  readOnly: '此部署中的网络偏好设置为只读。',
  unsupported: '此启动器不支持托管网络偏好设置。',
  setup: '此配置档案使用自定义网络配置。请更新启动配置并重启 DSH 后使用这些控件。',
  currentUrls: '当前网址',
  active: '本次启动已加载保存的偏好设置。',
  pendingRestart: '请重启 DSH 以加载保存的偏好设置。',
  cliOverride: '命令行覆盖正在生效。已保存的偏好设置不会替换这些覆盖。',
  hostOverride: '主机覆盖',
  portOverride: '端口覆盖',
  currentListener: '当前监听器',
} satisfies Record<keyof typeof networkEnglish, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.loopback-access': keyof typeof networkEnglish
  }
}

export const networkLocale = defineLocale(NETWORK_LOCALE_NAMESPACE, { en: networkEnglish, zh })
export type NetworkTranslate = TranslateNS<typeof NETWORK_LOCALE_NAMESPACE>
