import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const WORKBENCH_LOCALE_NAMESPACE = 'dshfiles.workbench'

const en = {
  title: 'Workbench',
  addPanel: 'Add panel',
  noMorePanels: 'Every panel is open',
  resetLayout: 'Reset layout',
  empty: 'No panel is open.',
  missingPanel: '“{id}” is not available. Its plugin may be disabled or removed; it comes back here once it registers again.',
  closePanel: 'Close panel',
  scratchpadTitle: 'Scratchpad',
  scratchpadPlaceholder: 'Type a draft, then move, split or float this panel: the text, caret and counters must survive.',
  mountsLabel: 'Mounts',
  rendersLabel: 'Renders',
  tickerTitle: 'Ticker',
  tickerHint: 'Counts seconds since this panel mounted. A remount restarts it at 0.',
  toggleRightPanel: 'Toggle the persistent panel in the right column',
  moveToMainView: 'Move to main view',
  toggleBottomPanel: 'Toggle the bottom panel',
  hideBottomPanel: 'Hide the bottom panel',
  hidePanel: 'Hide panel',
  bottomHeading: 'Panel',
  moveToDock: 'Move to the dock',
  moveToBottomPanel: 'Move to the bottom panel',
  movePanel: 'Move',
  layouts: 'Layouts',
  layoutsTitle: 'Saved layouts',
  layoutsHint: 'Save the current arrangement of every region and bring it back later. A layout only changes the regions it recorded.',
  layoutName: 'Layout name',
  saveLayout: 'Save current layout',
  applyLayout: 'Apply',
  renameLayout: 'Rename',
  deleteLayout: 'Delete',
  layoutEmpty: 'No saved layout yet.',
  cancel: 'Cancel',
  close: 'Close',
  sidePanelGuide: 'Dock and arrange registered panels beside the thread.',
  dockHeading: 'Panels',
}

const zh = {
  title: '工作台',
  addPanel: '添加面板',
  noMorePanels: '所有面板均已打开',
  resetLayout: '重置布局',
  empty: '没有打开的面板。',
  missingPanel: '“{id}” 不可用。其插件可能已禁用或移除；重新注册后会回到这里。',
  closePanel: '关闭面板',
  scratchpadTitle: '草稿板',
  scratchpadPlaceholder: '输入草稿，然后移动、拆分或浮动此面板：文本、光标和计数器都应保留。',
  mountsLabel: '挂载',
  rendersLabel: '渲染',
  tickerTitle: '计时器',
  tickerHint: '自此面板挂载以来的秒数。重新挂载会从 0 开始。',
  toggleRightPanel: '切换右栏的常驻面板',
  moveToMainView: '移到主视图',
  toggleBottomPanel: '切换底部面板',
  hideBottomPanel: '隐藏底部面板',
  hidePanel: '隐藏面板',
  bottomHeading: '面板',
  moveToDock: '移到右栏',
  moveToBottomPanel: '移到底部面板',
  movePanel: '移动',
  layouts: '布局',
  layoutsTitle: '已保存布局',
  layoutsHint: '保存当前各区域的排列，之后可随时恢复。布局只改回它记录过的区域。',
  layoutName: '布局名称',
  saveLayout: '保存当前布局',
  applyLayout: '应用',
  renameLayout: '重命名',
  deleteLayout: '删除',
  layoutEmpty: '还没有保存的布局。',
  cancel: '取消',
  close: '关闭',
  sidePanelGuide: '在会话旁停靠和排列已注册的面板。',
  dockHeading: '面板',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.workbench': keyof typeof en
  }
}

export type WorkbenchTranslate = TranslateNS<typeof WORKBENCH_LOCALE_NAMESPACE>

export const workbenchLocale = defineLocale(WORKBENCH_LOCALE_NAMESPACE, { en, zh })
