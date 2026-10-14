import { defineLocale } from '@dshfiles/dshx/client'

export const TOOLS_LOCALE_NAMESPACE = 'settings.pluginMarketplace.tools'

const zh = {
  tab: '工具',
  title: '智能体工具与插件能力',
  subtitle: '智能体可调用的每个工具、插件之间可调用的 API 方法，以及已加载的技能。',
  searchLabel: '搜索工具',
  searchPlaceholder: '按名称、来源或说明筛选',
  refresh: '刷新',
  loading: '正在读取能力目录…',
  unavailable: '能力目录暂时不可用：没有已加载的 dshx Host 提供它。',
  tools: '智能体工具（{count}）',
  apis: '插件 API 方法（{count}）',
  skills: '技能（{count}）',
  scope: '显示会话 {session} 中智能体看到的工具。',
  globalScope: '没有运行中的智能体：显示全局工具。',
  name: '名称',
  source: '来源',
  description: '说明',
  agentTool: '智能体工具',
  sourceApi: '插件 API',
  sourceMcp: 'MCP',
  sourceTool: '工具',
  noMatch: '没有匹配项。',
  noDescription: '无说明',
}

export const en: typeof zh = {
  tab: 'Tools',
  title: 'Agent tools and plugin capabilities',
  subtitle: 'Every tool the agent can call, every API method plugins can call on each other, and the loaded skills.',
  searchLabel: 'Search tools',
  searchPlaceholder: 'Filter by name, source or description',
  refresh: 'Refresh',
  loading: 'Reading the capability catalog…',
  unavailable: 'The capability catalog is unavailable: no loaded dshx Host serves it.',
  tools: 'Agent tools ({count})',
  apis: 'Plugin API methods ({count})',
  skills: 'Skills ({count})',
  scope: 'Tools as the agent of Session {session} sees them.',
  globalScope: 'No agent is running: showing global tools.',
  name: 'Name',
  source: 'Source',
  description: 'Description',
  agentTool: 'agent tool',
  sourceApi: 'plugin API',
  sourceMcp: 'MCP',
  sourceTool: 'tool',
  noMatch: 'Nothing matches.',
  noDescription: 'No description',
}

export const toolsLocale = defineLocale(TOOLS_LOCALE_NAMESPACE, { zh, en })
