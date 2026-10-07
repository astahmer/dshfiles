import type { Context, Disposable } from '@deepseek-ai/cordis'

/** Cleanup belongs to the native Cordis fiber, including failure and reload. */
export interface LifecycleApi {
  /** Register cleanup; the returned native disposer is idempotent. */
  onDispose(cleanup: Disposable<void>): Disposable<Promise<void>>
}

/** Native event signatures and dispatch modes remain intact. */
export type EventsApi = Pick<Context, 'on' | 'once' | 'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'>

type PluginContext = Pick<Context, keyof EventsApi | 'effect'>

export interface BasePluginApi<ContextType extends PluginContext = Context> {
  /** The actual scoped context: native services, DI, effects, and advanced APIs. */
  readonly raw: { readonly ctx: ContextType }
  /**
   * This plugin's own row configuration, already unwrapped to plain values.
   *
   * Protocol 2 removed the config field earlier generations put on the context,
   * so a plugin cannot reach its own settings any other way.
   */
  readonly config: Readonly<Record<string, unknown>>
  readonly lifecycle: LifecycleApi
  /** Listeners automatically unsubscribe with this plugin's native fiber. */
  readonly events: EventsApi
}

export function createBaseApi<ContextType extends PluginContext>(ctx: ContextType, config: Record<string, unknown> = {}): BasePluginApi<ContextType> {
  return {
    raw: { ctx },
    config: Object.freeze({ ...config }),
    lifecycle: {
      onDispose: cleanup => ctx.effect(() => cleanup, 'dshx cleanup'),
    },
    events: {
      on: ctx.on.bind(ctx),
      once: ctx.once.bind(ctx),
      emit: ctx.emit.bind(ctx),
      parallel: ctx.parallel.bind(ctx),
      serial: ctx.serial.bind(ctx),
      bail: ctx.bail.bind(ctx),
      waterfall: ctx.waterfall.bind(ctx),
    },
  }
}

export function assertPluginId(id: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new TypeError('Plugin id must use lowercase letters, digits, and hyphens, starting with a letter.')
}
