import type { DshCompatibility } from './types.js'

const VERIFIED_PROTOCOL_2_VERSIONS = ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-rc.2'] as const

/**
 * Adapter for the second observable DSH contract generation.
 *
 * The wire protocol is unchanged from `protocol-1`; what moved is the Client
 * package layout. `dsh-client-runtime` was folded into
 * `dsh-client-ui-conversation`, which now owns the conversation contract types,
 * and the separate `conversationEvents` registry no longer exists, so
 * component contributions remain experimental here.
 */
export const PROTOCOL_2_COMPATIBILITY: DshCompatibility = {
  id: 'protocol-2',
  protocolGeneration: 'protocol-2',
  lifecycle: 'active',
  version: '0.2.0-rc.1',
  // Package managers admit a prerelease only when a comparator names that exact patch, so every verified patch
  // prerelease needs its own lower bound.
  dshRange: '>=0.2.0-rc.1 <0.3.0-0 || >=0.2.1-rc.2 <0.3.0-0',
  verified: {
    minimum: VERIFIED_PROTOCOL_2_VERSIONS[0],
    latest: VERIFIED_PROTOCOL_2_VERSIONS[1],
  },
  verifiedVersions: VERIFIED_PROTOCOL_2_VERSIONS,
  nodeRange: '^22.19.0 || >=24.0.0',
  profile: { listCommand: 'plugin-list-json', addCommand: 'plugin-add' },
  runtimePlugins: [
    {
      id: 'cordis-host-runner',
      packageName: '@deepseek-ai/dsh-cordis-host-runner',
      load: 'default',
      provides: ['cordisInspect'],
      optional: true,
    },
    {
      id: 'tool-cordis',
      packageName: '@deepseek-ai/dsh-tool-cordis',
      load: 'module',
      provides: ['Service', 'Event'],
      optional: true,
    },
  ],
  inspect: {
    targets: ['slots', 'tools', 'services', 'events'],
    provider: 'unavailable',
    providerByTarget: {
      slots: 'runtime',
      tools: 'unavailable',
      services: 'runtime',
      events: 'runtime',
    },
    bridge: {
      protocolVersion: 1,
      serviceProvider: 'Service',
      eventProvider: 'Event',
    },
  },
  connection: {
    packageName: '@deepseek-ai/dsh-client-connection',
    clientModule: '@deepseek-ai/dsh-client-connection/client',
    protocolVersion: 1,
    hostRpc: true,
    clientRpc: true,
    hookDrivenCapabilityInference: true,
  },
  hostContributions: {
    commands: true,
    promptSections: true,
    promptContexts: true,
    settings: true,
  },
  session: {
    customDurableEventVocabulary: false,
  },
  client: {
    platformModules: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    preloadedExternals: ['@deepseek-ai/dsh-client-connection/client'],
    settings: {
      packageName: '@deepseek-ai/dsh-client-ui-settings',
      service: 'configForms',
      hookDrivenCapabilityInference: true,
    },
    conversation: {
      runtimePackageName: '@deepseek-ai/dsh-client-ui-conversation',
      rendererPackageName: '@deepseek-ai/dsh-client-ui-conversation',
      slotService: 'slots',
      componentContributions: false,
      verification: 'experimental',
    },
    manifest: {
      platform: 'web',
      moduleRequestsField: 'external',
      packageEdgesField: 'inject',
    },
  },
}
