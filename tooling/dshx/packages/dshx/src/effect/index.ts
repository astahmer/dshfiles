export * as DshxPlugin from './plugin.js'
export * as Api from './api.js'
export * as Tool from './tool.js'
export * as HostEvents from './events.js'
export { HostContext, HostServiceMissing, hostService } from './host-context.js'
export type { WireFailure } from './wire-error.js'
export { ApiCallError } from './client.js'
export type { EffectApiClient } from './client.js'
export { PublishEventError } from './dshx-effect.js'

/**
 * The first Effect API of dshx, kept while plugins move to `DshxPlugin.make`: `host`, `setup` and `plugin` run on
 * the same activation edge, wire mapping and tracer as `DshxPlugin.make`.
 * @deprecated Use `DshxPlugin`, `Api`, `Tool` and `HostEvents`.
 */
export * as DshxEffect from './dshx-effect.js'
