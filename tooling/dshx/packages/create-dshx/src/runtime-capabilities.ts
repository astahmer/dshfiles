/** Service injection maps small enough to embed in emitted plugin bundles. */
export const CLIENT_DEFAULT_SERVICES = ['locale', 'slots'] as const

export const CLIENT_CAPABILITY_INJECTIONS = {
  ui: ['slots'],
  panels: ['slots', 'layout'],
  sidebar: ['slots', 'layout'],
  composer: ['slots'],
  models: ['modelDirectories'],
  rpc: ['connection'],
} as const

export const HOST_CAPABILITY_INJECTIONS = {
  commands: ['commands'],
  tools: ['tools'],
  prompts: ['systemPrompt'],
  rpc: ['connection'],
} as const
