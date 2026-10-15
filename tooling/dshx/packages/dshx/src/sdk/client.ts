import { adaptClientSetup } from './setup.js'
import { CLIENT_CAPABILITY_INJECTIONS } from 'create-dshx/runtime-capabilities'
import type { Effect } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type { ComposedProps, SlotComponent } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { AnyApiMethodDefinition, ApiClient, ApiContract } from '../api/types.js'
import { createApiClient } from '../api/runtime.js'
import type { ClientContext, ClientDefinition } from '../client/types.js'
import { assertPluginId, createBaseApi, type BasePluginApi } from './lifecycle.js'

export interface UiApi {
  /** Native typed slots, automatically following declaration and plugin lifetimes. */
  readonly register: SlotRegistry['register']
}

export type PanelProps = ComposedProps<'main', string, never, undefined, object>
export type PanelIconProps = ComposedProps<'sidebar.panellist', string, never, undefined, object>

export interface PanelDefinition {
  readonly id: string
  readonly title: string
  readonly component: SlotComponent<PanelProps>
  readonly icon?: SlotComponent<PanelIconProps>
  readonly order?: number
}

export interface PanelHandle {
  /** Native selection; throws if the main-slot declaration is unavailable. */
  show(): void
  /** Remove the paired native contributions. Also runs automatically on unload. */
  dispose(): Promise<void>
}

export interface PanelsApi {
  /** Add a main view and its sidebar navigation row under the same native id. */
  register(definition: PanelDefinition): PanelHandle
}

/** Native Session props include typed inputActions and draft/session selectors. */
export type ComposerActionProps = ComposedProps<'conversation.input.left', string, never, undefined, object>

export interface ComposerActionDefinition {
  readonly id: string
  readonly placement?: 'left' | 'right'
  readonly order?: number
  readonly component: SlotComponent<ComposerActionProps>
}

export interface ComposerApi {
  /** Add a React control to the native composer toolbar; automatically removed on unload. */
  registerAction(definition: ComposerActionDefinition): () => void
}

export interface ModelDirectoryApi {
  readonly directoryFor: ModelDirectoryResolver['directoryFor']
}

export interface ClientCapabilities {
  readonly ui: UiApi
  readonly models: ModelDirectoryApi
  readonly panels: PanelsApi
  /** Sidebar panels use the same native main view/navigation pairing. */
  readonly sidebar: PanelsApi
  readonly composer: ComposerApi
  readonly rpc: {
    /** Calls the native Connection; shares the Host contract's inferred types. */
    use<Methods extends Record<string, AnyApiMethodDefinition>>(contract: ApiContract<Methods>): ApiClient<Methods>
  }
}

export type ClientCapability = keyof ClientCapabilities
export type ClientPluginApi<Uses extends readonly ClientCapability[] = readonly []> = BasePluginApi<ClientContext> & Pick<ClientCapabilities, Uses[number]>

export interface ClientPluginDefinition<Uses extends readonly ClientCapability[] = readonly []> extends Omit<ClientDefinition, 'name' | 'setup'> {
  readonly id: string
  readonly name?: string
  readonly uses?: Uses
  readonly setup?: (api: ClientPluginApi<Uses>) => void | Effect<void>
}

/** @internal Only this adapter erases the native slot overload implementation. */
export function createClientPluginApi<Uses extends readonly ClientCapability[]>(
  ctx: ClientContext,
  uses: readonly ClientCapability[],
  packageId: string,
  decorate: (component: unknown) => unknown = component => component,
): ClientPluginApi<Uses> {
  type NativeRegister = (options: { readonly name: string }, component: unknown) => () => void
  const ui: UiApi = {
    register: ((options: { readonly name: string }, component: unknown) => {
      if (ctx.get('slots') === undefined) throw new Error('UI slots are unavailable. Declare uses: ["ui"] and load the native UI renderer.')
      // Resolve the service through ctx inside the declaration callback, preserving caller ownership.
      return ctx.slots.inject(options.name as Parameters<SlotRegistry['inject']>[0], () => {
        return (ctx.slots.register as NativeRegister)(options, decorate(component))
      })
    }) as SlotRegistry['register'],
  }
  const panels: PanelsApi = {
    register(definition) {
      assertPluginId(definition.id)
      if (definition.id === 'conversation') throw new TypeError('Panel id "conversation" is reserved. Choose a plugin-owned id.')
      if (!definition.title.trim()) throw new TypeError('Panel title must be non-empty.')
      const id = definition.id as MainPanelId
      const dispose = ctx.effect(function* () {
        yield ui.register({ name: 'main', key: id }, definition.component)
        yield ui.register(
          {
            name: 'sidebar.panellist',
            id,
            order: definition.order ?? 100,
            label: definition.title,
          },
          definition.icon ?? (() => createElement('span', { 'aria-hidden': true }, definition.title.slice(0, 1))),
        )
      }, `dshx panel: ${definition.id}`)
      return { show: () => ctx.layout.selectPanel(id), dispose }
    },
  }
  const models: ModelDirectoryApi = {
    directoryFor: sessionId => ctx.modelDirectories.directoryFor(sessionId),
  }
  const capabilities: {
    -readonly [Key in keyof ClientCapabilities]?: ClientCapabilities[Key]
  } = {}
  for (const capability of uses) {
    switch (capability) {
      case 'ui':
        capabilities.ui = ui
        break
      case 'models':
        capabilities.models = models
        break
      case 'panels':
        capabilities.panels = panels
        break
      case 'sidebar':
        capabilities.sidebar = panels
        break
      case 'composer':
        capabilities.composer = {
          registerAction(definition) {
            assertPluginId(definition.id)
            return ui.register(
              {
                name: definition.placement === 'right' ? 'conversation.input.right' : 'conversation.input.left',
                id: definition.id,
                order: definition.order ?? 100,
              },
              definition.component,
            )
          },
        }
        break
      case 'rpc':
        capabilities.rpc = {
          use: contract => createApiClient(ctx, contract, packageId),
        }
        break
      default:
        throw new TypeError(`Unknown Client capability ${JSON.stringify(capability)}.`)
    }
  }
  return Object.assign(createBaseApi(ctx), capabilities) as ClientPluginApi<Uses>
}

/** Define the explicit browser half of a native DSH plugin. Ordinary React components receive native slot props. */
export function defineClientPlugin<const Uses extends readonly ClientCapability[] = readonly []>(definition: ClientPluginDefinition<Uses>): ClientDefinition {
  assertPluginId(definition.id)
  const { id, name, uses: declaredUses, setup, ...contributions } = definition
  const uses = declaredUses ?? []
  for (const capability of uses)
    if (!Object.hasOwn(CLIENT_CAPABILITY_INJECTIONS, capability)) throw new TypeError(`Unknown Client capability ${JSON.stringify(capability)}.`)
  return {
    ...contributions,
    name: name ?? id,
    inject: [...new Set([...(definition.inject ?? []), ...uses.flatMap(capability => CLIENT_CAPABILITY_INJECTIONS[capability])])],
    setup: adaptClientSetup(
      ctx => setup?.(createClientPluginApi<Uses>(ctx, uses, id)),
      (ctx, decorate, metadata) => setup?.(createClientPluginApi<Uses>(ctx, uses, metadata.packageId, decorate)),
    ),
  }
}
