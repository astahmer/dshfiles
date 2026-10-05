import { CLIENT_CAPABILITY_INJECTIONS, HOST_CAPABILITY_INJECTIONS } from './runtime-capabilities.js'

export { CLIENT_CAPABILITY_INJECTIONS, HOST_CAPABILITY_INJECTIONS } from './runtime-capabilities.js'

export const DSH_PROTOCOL_2 = {
  generation: 'protocol-2',
  version: '0.2.0-rc.2',
  range: '>=0.2.0-rc.1 <0.3.0-0',
} as const

export const SDK_RUNTIME_DEPENDENCIES = { zod: '^4.6.5' } as const

export const CORDIS_IDENTITY_DEPENDENCIES = {
  '@deepseek-ai/cordis': '~4.0.4',
  '@deepseek-ai/cordis-plugin-include': '1.0.9',
  '@deepseek-ai/cordis-plugin-loader': '1.0.5',
} as const

export const DSH_PACKAGES = {
  cordisHostRunner: '@deepseek-ai/dsh-cordis-host-runner',
  commands: '@deepseek-ai/dsh-commands',
  connection: '@deepseek-ai/dsh-client-connection',
  conversation: '@deepseek-ai/dsh-client-ui-conversation',
  layout: '@deepseek-ai/dsh-client-ui-layout',
  locale: '@deepseek-ai/dsh-client-locale',
  remotes: '@deepseek-ai/dsh-api-remotes',
  renderer: '@deepseek-ai/dsh-client-ui-renderer',
  slotContracts: '@deepseek-ai/dsh-client-ui-slots',
  sessionController: '@deepseek-ai/dsh-api-session-controller',
  settings: '@deepseek-ai/dsh-client-ui-settings',
  shortcuts: '@deepseek-ai/dsh-client-shortcuts',
  sidebar: '@deepseek-ai/dsh-client-ui-sidebar',
  systemPrompt: '@deepseek-ai/dsh-system-prompt',
  toolCordis: '@deepseek-ai/dsh-tool-cordis',
  tools: '@deepseek-ai/dsh-tools',
  uiWorkspace: '@deepseek-ai/dsh-client-ui-workspace',
  workspaceController: '@deepseek-ai/dsh-api-workspace-controller',
} as const

export const CLIENT_AUTHORING_TOOLCHAIN = {
  react: '^18.3.1',
  reactDom: '^18.3.1',
  reactTypes: '~18.3.31',
} as const

export const CLIENT_SERVICES = {
  locale: { packageName: DSH_PACKAGES.locale, availability: 'provided' },
  slots: { packageName: DSH_PACKAGES.renderer, availability: 'provided' },
  sessions: { packageName: DSH_PACKAGES.sessionController, availability: 'optional' },
  layout: { packageName: DSH_PACKAGES.layout, availability: 'optional' },
  shortcuts: { packageName: DSH_PACKAGES.shortcuts, availability: 'optional' },
  uiWorkspace: { packageName: DSH_PACKAGES.uiWorkspace, availability: 'optional' },
  workspaces: { packageName: DSH_PACKAGES.workspaceController, availability: 'optional' },
  commandUi: { packageName: '@deepseek-ai/dsh-client-ui-commands', availability: 'optional' },
  remote: { packageName: DSH_PACKAGES.remotes, availability: 'optional' },
  connection: { packageName: DSH_PACKAGES.connection, availability: 'provided' },
  configForms: { packageName: DSH_PACKAGES.settings, availability: 'optional' },
} as const

export type ClientNativeService = keyof typeof CLIENT_SERVICES

export const CLIENT_CAPABILITIES = {
  ui: {
    cordisServices: CLIENT_CAPABILITY_INJECTIONS.ui,
    providers: [CLIENT_SERVICES.slots.packageName],
  },
  panels: {
    cordisServices: CLIENT_CAPABILITY_INJECTIONS.panels,
    providers: [CLIENT_SERVICES.slots.packageName, CLIENT_SERVICES.layout.packageName, DSH_PACKAGES.sidebar],
  },
  sidebar: {
    cordisServices: CLIENT_CAPABILITY_INJECTIONS.sidebar,
    providers: [CLIENT_SERVICES.slots.packageName, CLIENT_SERVICES.layout.packageName, DSH_PACKAGES.sidebar],
  },
  composer: {
    cordisServices: CLIENT_CAPABILITY_INJECTIONS.composer,
    providers: [CLIENT_SERVICES.slots.packageName, DSH_PACKAGES.conversation],
  },
  rpc: {
    cordisServices: CLIENT_CAPABILITY_INJECTIONS.rpc,
    providers: [CLIENT_SERVICES.connection.packageName],
  },
} as const satisfies Record<string, { readonly cordisServices: readonly ClientNativeService[]; readonly providers: readonly string[] }>

export const HOST_CAPABILITIES = {
  commands: { cordisServices: HOST_CAPABILITY_INJECTIONS.commands, providers: [DSH_PACKAGES.commands] },
  tools: { cordisServices: HOST_CAPABILITY_INJECTIONS.tools, providers: [DSH_PACKAGES.tools, DSH_PACKAGES.toolCordis] },
  prompts: { cordisServices: HOST_CAPABILITY_INJECTIONS.prompts, providers: [DSH_PACKAGES.systemPrompt] },
  rpc: { cordisServices: HOST_CAPABILITY_INJECTIONS.rpc, providers: [CLIENT_SERVICES.connection.packageName] },
} as const satisfies Record<string, { readonly cordisServices: readonly string[]; readonly providers: readonly string[] }>

export const UNAVAILABLE_PROTOCOL_2_CAPABILITIES = {
  conversationEvents: 'DSH protocol 2 removed the conversationEvents registry; use native UI slots.',
  customDurableEvents: 'DSH protocol 2 does not expose a custom durable event vocabulary.',
} as const
