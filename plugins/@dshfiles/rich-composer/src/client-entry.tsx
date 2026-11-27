import { agentsApi } from '@dshfiles/agents/contract'
import { Command, Composer, createApiClient, defineClient } from '@dshfiles/dshx/client'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { ConversationScope } from '@dshfiles/workbench/conversation-header'
import { PhoneMenuScope } from './phone-menu-scope.tsx'
import { AgentChipTone } from './agent-chip-tone.ts'
import { agentWarmupApi } from './agent-warmup-api.ts'
import type {} from './agent-warmup.ts'
import { AgentPresetVisibility } from './agent-preset-visibility.ts'
import { composerControlsSettings } from './composer-controls-settings.ts'
import { SendWhenUploaded } from './held-send.ts'
import { createComposerService } from './composer-service.ts'
import { ComposerSnippets } from './composer-snippets.ts'
import { PhoneThreadMenu } from './phone-thread-menu.tsx'
import { createPhoneThreadMenu } from './phone-thread-menu-service.ts'
import { apply, inject } from './native/index.js'
import type {} from '@deepseek-ai/dsh-permission-presets/remote'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import { ComposerBar, type ComposerBarPlacement } from './composer-more.ts'
import { ComposerSendPreparers } from './composer-send.ts'
import { ComposerSendPipeline } from './composer-send-pipeline.ts'
import { ComposerMoreMenu } from './composer-more-menu.tsx'
import { ModeChip } from './mode-chip.tsx'
import { ModeChipCatalog, type ModeChipHost } from './mode-chip-model.ts'
import { RpcFailure } from './rpc-failure.ts'
import { threadHeaderMenuOf } from './thread-header-menu.ts'
import { ThreadViewsModel } from './thread-views.ts'

type ComposerControls = SettingsValue<typeof composerControlsSettings.schema>

const HiddenPermissionSelector = (): null => null
const HiddenPlanChip = (): null => null

export default defineClient({
  name: '@dshfiles/rich-composer',
  inject: [...inject, 'sessionDrafts'],
  setup(ctx, _decorate, metadata) {
    metadata?.plugin?.provide(PhoneThreadMenu, createPhoneThreadMenu())
    metadata?.plugin?.provide(ConversationScope, { Scope: PhoneMenuScope })
    apply(ctx)
    const preparers = metadata?.plugin?.list(ComposerSendPreparers)
    if (preparers !== undefined) ctx.effect(() => ComposerSendPipeline.bind(() => preparers.get()), 'rich-composer: new-thread send preparers')
    metadata?.plugin?.provide(Composer, createComposerService(ctx))
    // Agent mentions in a draft wear the colour the agent chose; one shared registry read, the hashed slot without it.
    const agents = createApiClient(ctx, agentsApi)
    ctx.effect(
      () =>
        AgentChipTone.install(async () => {
          const listed = await agents.safe.list()
          if (!listed.ok) return null
          return new Map(listed.value.agents.flatMap(agent => (agent.tone === undefined ? [] : [[agent.handle, agent.tone] as const])))
        }),
      'rich-composer: agent mention colours',
    )
    // The header's More actions as plain rows, for the thread menu that lists them (thread-views.ts): one `⋯` per header.
    ctx.effect(
      () =>
        ThreadViewsModel.provideHeaderMenu(sessionId => {
          const menus = ctx.get('contextMenus')
          return menus === undefined ? undefined : threadHeaderMenuOf(menus.resolve({ kind: 'sessionHeader', value: { sessionId: SessionId(sessionId) } }))
        }),
      'rich-composer: thread header menu',
    )
    // The composer's own keymap runs these chords (it knows the draft, the uploads and the IME); these rows only list
    // them in the ? sheet, so their run declines and the key goes on to the editor.
    for (const command of [
      { id: 'send-background', title: 'Send and keep a fresh draft (new-thread page)', keys: ['Mod+Enter'] },
      { id: 'send-and-new', title: 'Send and start a new thread', keys: ['Mod+Alt+Enter'] },
      { id: 'send-accelerated', title: 'Steer or queue while a turn runs', keys: ['Mod+Enter'] },
    ])
      metadata?.plugin?.add(Command, {
        id: `@dshfiles/rich-composer.${command.id}`,
        title: command.title,
        keys: command.keys,
        scope: 'composer',
        section: 'Composer',
        hidden: true,
        run: () => false,
      })
    ctx.inject(['inputTriggers'], scope => {
      scope.effect(() => {
        const inputTriggers = scope.get('inputTriggers')
        return ComposerSnippets.isSourceRegistry(inputTriggers) ? ComposerSnippets.register(inputTriggers) : () => {}
      }, 'rich-composer: quote and note chips')
    })

    const warmup = createApiClient(ctx, agentWarmupApi)
    ctx.on('dshfiles/composer/first-edit', sessionId => {
      // A New chat is only local until its first edit. Never warm a Host identity before creation settles.
      void (async () => {
        await ctx.get('sessionDrafts')?.whenCreated(sessionId)
        await warmup.warm({ sessionId })
      })().catch(() => undefined)
    })

    // The permission seat is a single slot: a lower-priority empty occupant shadows the native selector, and
    // disposing it hands the seat back, so the toggle applies live without touching the vendored InputBar.
    const controls = ctx.configForms.get<ComposerControls>(composerControlsSettings.namespace)
    let disposeShadow: (() => void) | undefined
    const sync = (): void => {
      AgentPresetVisibility.set(controls.getSnapshot().value?.showAgentPresetPicker === true)
      // An older Host without this field reads as on, the default.
      SendWhenUploaded.set(controls.getSnapshot().value?.sendWhenUploaded !== false)
      const hide = controls.getSnapshot().value?.hidePermissionSelector === true
      if (hide && disposeShadow === undefined) {
        // Below the mode chip's -1: the hidden seat wins over every occupant, the chip included.
        disposeShadow = ctx.slots.register({ name: 'conversation.input.permission', priority: -2 }, HiddenPermissionSelector)
        return
      }
      if (!hide && disposeShadow !== undefined) {
        disposeShadow()
        disposeShadow = undefined
      }
    }
    const unsubscribe = controls.subscribe(sync)
    sync()
    ctx.effect(() => () => {
      unsubscribe()
      disposeShadow?.()
    })

    // One mode chip (composer redesign b:v9yh): plan mode and file access in plain words, in the file-access seat. It
    // needs the permission catalog Remote and slash commands; without them the native seats stay as they were.
    ctx.inject(['remote.permissionPresets', 'remote.commands'], scope => {
      const remote = scope.remote
      const host: ModeChipHost = {
        catalog: () => remote.permissionPresets.catalog(),
        onCatalogChanged: listener => remote.$on('permission-presets/catalog-changed', listener),
        run: async (sessionId, line) => {
          const result = await remote.commands.execute(SessionId(sessionId), line, [])
          if (!result.ok) return RpcFailure.sentence({ subject: 'Plan mode and file access', error: result.error })
          return result.value === undefined ? `this DSH has no ${line.split(' ')[0] ?? line} command` : null
        },
      }
      const catalog = new ModeChipCatalog(host)
      const Seat = (props: { readonly sessionId: string; readonly locked: boolean; readonly useProjection: UseProjection }) => (
        <ModeChip catalog={catalog} host={host} locked={props.locked} sessionId={props.sessionId} useProjection={props.useProjection} />
      )
      scope.effect(() => {
        const disposeSeat = ctx.slots.register({ name: 'conversation.input.permission', priority: -1 }, Seat)
        // The native plan seat is a "Plan ×" exit button; the chip's Mode section replaces it. agent-plan still draws
        // its pinned step beside whatever holds that seat.
        const disposePlan = ctx.slots.register({ name: 'conversation.input.plan', priority: -1 }, HiddenPlanChip)
        return () => {
          disposePlan()
          disposeSeat()
          catalog.dispose()
        }
      }, 'rich-composer: mode chip')
    })

    // Undo, history and saved prompts live in one More (⋯) menu unless the user pins them back (polish pass b:r4et).
    // The setting is read live; plugins follow it through the ComposerBar contract and draw their own buttons when pinned.
    const placement: ComposerBarPlacement = {
      pinned: () => controls.getSnapshot().value?.showComposerExtras === true,
      subscribe: listener => controls.subscribe(listener),
    }
    metadata?.plugin?.provide(ComposerBar, placement)
    const MoreSeat = _decorate((props: { readonly sessionId: string }) => <ComposerMoreMenu placement={placement} sessionId={props.sessionId} />)
    ctx.slots.inject('conversation.input.right', () =>
      ctx.slots.register({ name: 'conversation.input.right', id: 'dshfiles-rich-composer-more', order: 90 }, MoreSeat),
    )
  },
})
