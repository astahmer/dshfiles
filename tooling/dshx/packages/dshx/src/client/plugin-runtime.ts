import { AppServicesModel } from './app-services.js'
import { PluginHooksModel } from './hooks.js'
import { PluginContextModel, type NativeSlots, type PluginContext } from './plugin-context.js'

type ComponentDecorator = <Component>(component: Component) => Component

/** The Cordis context members the plugin runtime reads. */
interface RuntimeHostContext {
  effect?(execute: () => () => void, label?: string): unknown
  get(name: string): unknown
  on?(name: string, listener: () => void): () => boolean
}

const isNativeSlots = (value: unknown): value is NativeSlots =>
  typeof value === 'object' &&
  value !== null &&
  'inject' in value &&
  typeof value.inject === 'function' &&
  'register' in value &&
  typeof value.register === 'function'

/**
 * Build the plugin context behind `add`, `provide`, `use` and `usePlugin`,
 * scoped to one Cordis fiber: plugin disposal and HMR end every registration it made.
 *
 * The returned decorator also provides that context to the components it wraps.
 */
const createPluginRuntime = (input: {
  readonly ctx: RuntimeHostContext
  readonly packageId: string
  readonly decorate: ComponentDecorator
}): { readonly plugin: PluginContext; readonly decorate: ComponentDecorator } => {
  const scope = PluginContextModel.createScope()
  if (typeof input.ctx.effect === 'function') input.ctx.effect(() => () => scope.dispose(), 'dshx plugin scope')
  let plugin: PluginContext | undefined
  const decorate: ComponentDecorator = component => {
    const decorated = input.decorate(component)
    return plugin === undefined ? decorated : PluginHooksModel.provide(decorated, plugin)
  }
  plugin = PluginContextModel.create({
    owner: input.packageId,
    scope,
    slots: () => {
      const slots = input.ctx.get('slots')
      return isNativeSlots(slots) ? slots : undefined
    },
    decorate,
    services: {
      dialogs: AppServicesModel.dialogs,
      toast: AppServicesModel.toast,
      commands: AppServicesModel.createCommands(() => input.ctx.get('shortcuts')),
      layout: AppServicesModel.createLayout({ layout: () => input.ctx.get('layout'), sidebarRight: () => input.ctx.get('sidebarRight') }),
      system: AppServicesModel.system,
      notifications: AppServicesModel.notifications,
      environment: AppServicesModel.createEnvironment({
        service: name => input.ctx.get(name),
        on: (event, listener) => input.ctx.on?.(event, listener) ?? (() => false),
      }),
    },
  })
  return { plugin, decorate }
}

export class PluginRuntimeModel {
  static readonly create = createPluginRuntime
}
