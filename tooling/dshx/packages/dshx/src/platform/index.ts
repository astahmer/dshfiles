export { connectDshPlatformClient, createDshPlatformClientFromTransport, DshPlatformError, loopbackLaunchUrl } from './client.js'
export { connectDshxApi, createDshxApiCaller } from './dshx-api.js'
export type { DshxApiCall, DshxApiCallerOptions } from './dshx-api.js'
export type {
  BundleSummary,
  ChangeResult,
  CommandSummary,
  ConnectDshPlatformClientOptions,
  DshPlatformClient,
  DshPlatformTransport,
  JsonValue,
  PluginSummary,
  SessionPage,
  SessionAttentionAction,
  SessionAttentionSummary,
  SessionAttentionUpdateRequest,
  SessionSummary,
  SettingsDescription,
  SettingsNamespace,
} from './client.js'
