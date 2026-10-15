import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandClaim, InputTriggerSource } from '@dshfiles/input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PaletteApi } from '@dshfiles/command-palette/api'
import { defineClient } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { MessageCircleQuestionIcon } from '@dshfiles/plugin-ui/icons'
import { useSelector } from '@dshfiles/plugin-ui/machine'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore, type ReactNode } from 'react'
import { z } from 'zod'
import { BTW_LOCALE_NAMESPACE, btwLocale, type BtwKey } from './locales.js'
import { mainViewThreadId } from './main-view-thread.js'
import { PrefixCache } from './prefix-cache.js'
import { sideChatStarted, startSideChat, type ModelRoute, type SideChatActor } from './side-chat-machine.js'
import { SideQuestionDialog } from './side-question-dialog.js'

const TAB_ID = '@dshfiles/btw'
const TAB_KIND = 'btwchat'
const ADDRESS_PREFIX = 'dsh-resource://btwchat/session/'
const CONVERSATION_SLOT = 'dshfiles.btw.conversation'
const ASK_SHORTCUT_ID = 'btw.askSideQuestion'
const ASK_SHORTCUT = { code: 'Slash', modifiers: ['primary', 'alt'] } as const

interface SideChatResource {
  readonly childId: SessionId
  readonly reference: SessionReference
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A /btw side chat retained by its right-sidebar tab, and while it is forked and asked. */
    btwSideChat: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    btwchat: SideChatResource
  }
  interface SlotMap {
    /** Session-scoped Conversation of one /btw side chat, hosted by its right-sidebar tab. */
    'dshfiles.btw.conversation': {
      kind: 'single'
      scope: 'session'
    }
  }
}

const addressOf = (childId: string): string => `${ADDRESS_PREFIX}${encodeURIComponent(childId)}`
const childIdOf = (address: string): string | undefined =>
  address.startsWith(ADDRESS_PREFIX) ? decodeURIComponent(address.slice(ADDRESS_PREFIX.length)) || undefined : undefined

const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional() })
const selectionSchema = z.object({ next: routeSchema.nullable().optional(), lastUsed: routeSchema.nullable().optional() })
const closeHandlerSchema = z.object({ registerCloseHandler: z.instanceof(Function) })

interface CloseHandlerHost {
  registerCloseHandler(kind: string, handler: (sessionId: SessionId, tab: { readonly contentId: string }) => void): () => void
}
// The concrete right-sidebar controller has it; the typed `ISidebarRight` face does not.
const hasCloseHandlers = (value: unknown): value is CloseHandlerHost => closeHandlerSchema.safeParse(value).success
const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)

/** Live side chats of this page, by fork id: the tab's close and the panel header find their flow here. */
const sideChats = new Map<string, SideChatActor>()

const FixedChatView = (props: ConversationViewsProps): ReactNode => props.renderSlot('conversation.session', { view: 'chat' })

const SideChatConversation = (props: PropsRuntime<typeof CONVERSATION_SLOT> & PropsRenderFactories): ReactNode =>
  props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, { slots: { views: FixedChatView } })

type Translate = (key: BtwKey, params?: Record<string, string | number>) => string

const CacheReading = (props: { readonly reference: SessionReference; readonly t: Translate }): ReactNode => {
  const source = props.reference.binding.eventSource
  const events = useSyncExternalStore(
    listener => source.subscribe(listener),
    () => source.getSnapshot(),
  )
  const reading = PrefixCache.firstRequestAfterFork(events.entries.map(entry => entry.event))
  if (reading === undefined) return <span>{props.t('cacheWaiting')}</span>
  return (
    <span data-testid="dshfiles-btw-cache" title={`${String(reading.cacheReadTokens)} cached / ${String(reading.inputTokens)} uncached input tokens`}>
      {props.t('cache', { share: Math.round(reading.cacheReadShare * 100) })}
    </span>
  )
}

const SideChatStatus = (props: { readonly actor: SideChatActor; readonly t: Translate }): ReactNode => {
  const state = useSelector(props.actor, snapshot => (snapshot.matches('failed') ? `failed:${snapshot.context.error ?? ''}` : String(snapshot.value)))
  if (!state.startsWith('failed:')) return state === 'asking' ? <span>{props.t('thinking')}</span> : null
  return (
    <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-destructive">
      {props.t('failed', { reason: state.slice('failed:'.length) })}
      <Button size="sm" variant="ghost" className="dshx:h-6 dshx:px-2 dshx:text-xs" onClick={() => props.actor.send({ type: 'dismiss' })}>
        {props.t('dismiss')}
      </Button>
    </span>
  )
}

export default defineClient({
  name: '@dshfiles/btw',
  locales: [btwLocale],
  inject: ['slots', 'sessions', 'workspaces', 'remote', 'remote.session', 'inputTriggers', 'resources', 'sidebarRight', 'sidebarRightTabs', 'shortcuts'],
  setup(ctx) {
    const t: Translate = (key, params) => ctx.locale.bind(BTW_LOCALE_NAMESPACE)(key, params)

    const routeOf = (sessionId: SessionId): ModelRoute | null => {
      const face = ctx.sessions.binding(sessionId)?.session.projections.faceOf('modelSelection')
      const parsed = selectionSchema.safeParse(face?.getSnapshot())
      if (!parsed.success) return null
      return parsed.data.next ?? parsed.data.lastUsed ?? null
    }

    const startBtw = (sourceId: SessionId, question: string): SideChatActor => {
      let held: SessionReference | undefined
      const actor = startSideChat({
        sourceId,
        question,
        route: routeOf(sourceId),
        ports: {
          // No `atSeq`: the Host cuts at the latest completed turn, the prefix the provider has already cached.
          fork: async () => {
            const childId = await ctx.sessions.fork({ sessionId: sourceId })
            sideChats.set(childId, actor)
            return childId
          },
          configure: async input => {
            const childId = ctx.sessions.list.getSnapshot().ids.find(id => id === input.childId)
            if (childId === undefined) throw new Error('the side chat thread is not listed')
            const renamed = await ctx.remote.session.rename({ sessionId: childId, title: input.title })
            if (!renamed.ok) throw new Error(renamed.error.message)
            if (input.route === null) return
            const { reasoningEffort, ...route } = input.route
            const selected = await ctx.remote.session.selectModel(
              reasoningEffort === undefined ? { sessionId: childId, ...route } : { sessionId: childId, ...route, reasoningEffort },
            )
            if (!selected.ok) throw new Error(selected.error.message)
          },
          ask: async input => {
            const childId = ctx.sessions.list.getSnapshot().ids.find(id => id === input.childId)
            if (childId === undefined) throw new Error('the side chat thread is not listed')
            held = ctx.sessions.retain(childId, { source: 'btwSideChat' })
            await held.ready
            const session = held.binding.session
            const handle = session.beginSubmission({ mode: 'queue', text: input.question, attachments: [] })
            const result = await session.prompt([{ type: 'text', text: input.question }], 'queue', undefined, handle.requestId)
            if (!result.ok) throw new Error(result.error.message)
          },
          openPanel: childId => ctx.sidebarRight.openResource(addressOf(childId), { kind: TAB_KIND, preferNewPane: true }),
          archive: async childId => {
            held?.release()
            held = undefined
            sideChats.delete(childId)
            const listed = ctx.sessions.list.getSnapshot().ids.find(id => id === childId)
            if (listed !== undefined) await ctx.workspaces.archiveSession(listed, { stopActivity: true })
          },
        },
      })
      return actor
    }

    const claimFor = (sessionId: SessionId): CommandClaim => ({
      name: 'btw',
      token: '/btw ',
      hint: t('hint'),
      submit: async args => {
        const question = args.trim()
        if (question === '') return { kind: 'error', text: t('empty') }
        const started = await sideChatStarted(startBtw(sessionId, question))
        return started.ok ? { kind: 'success' } : { kind: 'error', text: t('failed', { reason: started.reason }) }
      },
    })

    // The palette, the composer chip and the shortcut open one question dialog for a thread; the overlay draws it.
    const askTarget = createSnapshotStore<SessionId | null>(null)
    const listedThread = (threadId: string | undefined): SessionId | undefined => {
      const snapshot = ctx.sessions.list.getSnapshot()
      const sessionId = snapshot.ids.find(id => id === threadId)
      return sessionId === undefined || snapshot.byId[sessionId]?.blank !== false ? undefined : sessionId
    }
    const askAbout = (threadId: string | undefined): boolean => {
      const sessionId = listedThread(threadId)
      if (sessionId === undefined) return false
      askTarget.set(sessionId)
      return true
    }
    const mainViewThread = (): SessionId | undefined => {
      const snapshot = ctx.sessions.list.getSnapshot()
      return mainViewThreadId(snapshot.ids.flatMap(id => snapshot.byId[id] ?? []))
    }

    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dshfiles-btw-ask', order: 110, locale: BTW_LOCALE_NAMESPACE },
            (props: PropsRuntime<'shell.overlay'>) => {
              const target = useSyncExternalStore(askTarget.subscribe, askTarget.getSnapshot)
              const title = props.useSessions(state => (target === null ? '' : (state.byId[target]?.displayTitle ?? '')))
              if (target === null) return null
              return (
                <PluginQueryProvider>
                  <SideQuestionDialog
                    key={target}
                    threadTitle={title}
                    t={t}
                    onClose={() => askTarget.set(null)}
                    ask={async question => {
                      const started = await sideChatStarted(startBtw(target, question))
                      if (!started.ok) throw new Error(t('failed', { reason: started.reason }))
                    }}
                  />
                </PluginQueryProvider>
              )
            },
          ),
        ),
      'dshfiles-btw: side question dialog',
    )

    ctx.effect(
      () =>
        PaletteApi.registerAction({
          id: '@dshfiles/btw/ask',
          label: () => t('paletteAsk'),
          aliases: ['btw', 'side question', 'side chat', 'ask about this thread', 'fork'],
          icon: <MessageCircleQuestionIcon className="dshx:size-4" />,
          group: 'action',
          isAvailable: context => context.thread !== null && !context.thread.archived && listedThread(context.thread.id) !== undefined,
          run: context => {
            askAbout(context.thread?.id)
          },
        }),
      'dshfiles-btw: command palette action',
    )

    if (isShortcutCommandId(ASK_SHORTCUT_ID))
      ctx.effect(() => {
        const register = (withDefaults: boolean): (() => void) =>
          ctx.shortcuts.register({
            id: ASK_SHORTCUT_ID,
            label: () => t('paletteAsk'),
            aliases: ['btw', 'side question', 'side chat'],
            defaults: withDefaults
              ? {
                  'desktop:macos': ASK_SHORTCUT,
                  'desktop:windows': ASK_SHORTCUT,
                  'desktop:linux': ASK_SHORTCUT,
                  'web:macos': ASK_SHORTCUT,
                  'web:windows': ASK_SHORTCUT,
                }
              : {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => {
              const sessionId = mainViewThread()
              return sessionId === undefined ? { status: 'pass' } : { status: 'handled', run: () => askAbout(sessionId) }
            },
          })
        // Another plugin may already own the default chord; keep the command listed and rebindable, unbound.
        try {
          return register(true)
        } catch (error) {
          console.warn(`dshfiles-btw: ${ASK_SHORTCUT_ID} keeps no default binding`, error)
          try {
            return register(false)
          } catch {
            return () => undefined
          }
        }
      }, 'dshfiles-btw: side question shortcut')

    const ComposerChip = (props: PropsRuntime<'conversation.input.right'>): ReactNode => {
      const available = props.useSessions(state => state.byId[props.sessionId]?.blank === false)
      if (!available) return null
      const label = t('composerChip')
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          className="dshx-root dshx:text-muted-foreground dshx:hover:text-foreground"
          onMouseDown={event => event.preventDefault()}
          onClick={() => askAbout(props.sessionId)}
        >
          <MessageCircleQuestionIcon aria-hidden />
        </Button>
      )
    }
    // Icon-only and before Prompts (60): it never carries a label, so it adds nothing to the composer's collapse order.
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: 'dshfiles-btw-ask', order: 55 }, ComposerChip),
        ),
      'dshfiles-btw: composer chip',
    )

    const source: InputTriggerSource = {
      trigger: '/',
      name: 'btw',
      async candidates(_session, request) {
        return request.position === 'leading' && 'btw'.startsWith(request.query.toLowerCase()) ? [{ name: 'btw', description: t('description') }] : []
      },
      onPick: pick => ({ claim: claimFor(pick.session.sessionId) }),
      async matchEnter(session, line) {
        return line === '/btw' || line.startsWith('/btw ') ? { claim: claimFor(session.sessionId) } : undefined
      },
    }
    ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dshfiles-btw: /btw command')

    ctx.effect(
      () =>
        ctx.resources.register({
          protocol: TAB_KIND,
          async *open(address, { signal }) {
            const listed = ctx.sessions.list.getSnapshot().ids.find(id => id === childIdOf(address))
            if (listed === undefined) throw new Error(`btw: no side chat at "${address}"`)
            const reference = ctx.sessions.retain(listed, { source: 'btwSideChat', signal })
            try {
              yield { ok: true, value: { childId: listed, reference } }
              await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
            } finally {
              reference.release()
            }
          },
        }),
      'dshfiles-btw: side chat resources',
    )

    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          patterns: [`${ADDRESS_PREFIX}**`],
          canOpen: address => childIdOf(address) !== undefined,
          title: address => {
            const snapshot = ctx.sessions.list.getSnapshot()
            const childId = snapshot.ids.find(id => id === childIdOf(address))
            return (childId === undefined ? undefined : snapshot.byId[childId]?.displayTitle) ?? 'btw'
          },
        }),
      'dshfiles-btw: side chat tab type',
    )

    ctx.effect(() => {
      if (!hasCloseHandlers(ctx.sidebarRight)) return () => {}
      return ctx.sidebarRight.registerCloseHandler(TAB_KIND, (_sessionId, tab) => {
        const childId = childIdOf(tab.contentId)
        if (childId === undefined) return
        const actor = sideChats.get(childId)
        if (actor !== undefined) return actor.send({ type: 'close' })
        // A side chat from before a reload has no flow left; closing its tab still archives it.
        const listed = ctx.sessions.list.getSnapshot().ids.find(id => id === childId)
        if (listed !== undefined) void ctx.workspaces.archiveSession(listed, { stopActivity: true })
      })
    }, 'dshfiles-btw: archive a side chat when its tab closes')

    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            { name: 'sidebar.right.pane.tab', key: TAB_ID, children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } } },
            (props: PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<typeof CONVERSATION_SLOT>) => {
              const { tab } = props.useTabInfo()
              const resource = props.useResource(tab.contentId)
              const actor = sideChats.get(childIdOf(tab.contentId) ?? '')
              return (
                <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" data-dshfiles-btw="">
                  <div className="dshx:flex dshx:items-center dshx:gap-3 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
                    {actor === undefined ? null : <SideChatStatus actor={actor} t={t} />}
                    {resource.value === undefined ? null : <CacheReading reference={resource.value.reference} t={t} />}
                  </div>
                  <div className="dshx:min-h-0 dshx:flex-1">
                    {resource.value === undefined ? null : (
                      <props.SessionProvider session={resource.value.reference}>{props.renderSlot(CONVERSATION_SLOT, {})}</props.SessionProvider>
                    )}
                  </div>
                </div>
              )
            },
          ),
        ),
      'dshfiles-btw: side chat tab body',
    )
    ctx.effect(
      () => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({ name: CONVERSATION_SLOT }, SideChatConversation)),
      'dshfiles-btw: side chat Conversation',
    )
  },
})
