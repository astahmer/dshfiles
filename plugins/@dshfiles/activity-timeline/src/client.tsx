import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { attentionApi } from './attention-api.js'
import { NextWaiting } from './next-waiting.js'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ActivityTimelinePanel } from './panel.js'
import { InboxGlyph } from './inbox-glyph.js'
import { INBOX_LOCALE_NAMESPACE, inboxLocale } from './inbox-locales.js'
import { InboxPanel, openThread } from './inbox-panel.js'
import { ACTIVITY_TIMELINE_LOCALE_NAMESPACE, activityTimelineLocale } from './locales.js'

const PANEL_ID = 'activity-timeline'
/** Temporary left-nav placement until the Phase 3 rail (plans/ade-ux §4.2). */
const INBOX_PANEL_ID = 'attention-inbox'

const PanelGlyph = (props: { readonly size?: number }): JSX.Element => (
  <svg aria-hidden width={props.size ?? 18} height={props.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M4 6h16M4 12h10M4 18h13" />
    <circle cx="19" cy="12" r="1.4" />
  </svg>
)

export default defineClient({
  name: '@dshfiles/activity-timeline',
  locales: [activityTimelineLocale, inboxLocale],
  inject: ['slots', 'sessions', 'uiWorkspace', 'workspaces', 'shortcuts'],
  setup(ctx, decorate, metadata) {
    const translate = ctx.locale.bind(ACTIVITY_TIMELINE_LOCALE_NAMESPACE)
    const label = (): string => `Activity Timeline: ${translate('title')}`
    const inboxTranslate = ctx.locale.bind(INBOX_LOCALE_NAMESPACE)
    const navigation = { sessions: ctx.sessions, uiWorkspace: ctx.uiWorkspace, workspaces: ctx.workspaces }
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: INBOX_PANEL_ID, order: 2, label: () => inboxTranslate('title'), locale: INBOX_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <InboxGlyph size={props.size} navigation={navigation} />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: INBOX_PANEL_ID, locale: INBOX_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <InboxPanel {...navigation} t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
    // Jump to next waiting (plans/ade-ux §4.8): ⌥J opens the next Needs you item's thread, cycling; with nothing waiting,
    // or an item that is not about a thread, it opens the Inbox. The Web shortcut registry admits no ⌥-letter default,
    // so the registry row lists the command in Settings › Key bindings and the palette (a user binding there runs it
    // too) while a capture-phase listener claims ⌥J itself, as @dshfiles/shortcuts does for chords the registry cannot.
    const inbox = createApiClient(ctx, attentionApi)
    let lastJumpedId: string | null = null
    const openInbox = (): void => {
      metadata?.plugin?.layout.openPanel(INBOX_PANEL_ID)
    }
    const jumpToNextWaiting = async (): Promise<void> => {
      const { items } = await inbox.list({ view: 'needs-you', limit: 200 })
      const index = NextWaiting.next({ items, lastId: lastJumpedId })
      const item = index === null ? undefined : items[index]
      if (item === undefined) {
        openInbox()
        return
      }
      lastJumpedId = item.id
      if (item.subject.kind !== 'session' || !openThread(navigation, item.subject.id)) openInbox()
    }
    const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)
    const JUMP_COMMAND_ID = 'inbox.nextWaiting'
    if (isShortcutCommandId(JUMP_COMMAND_ID)) {
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: JUMP_COMMAND_ID,
            label: () => inboxTranslate('jumpNextWaiting'),
            aliases: ['next waiting', 'needs you', 'inbox', 'attention', 'jump', 'option j', 'alt j', '⌥J'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({
              status: 'handled',
              run: () => {
                void jumpToNextWaiting().catch(openInbox)
              },
            }),
          }),
        'activity-timeline: jump to next waiting',
      )
    }
    ctx.effect(() => {
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented || event.code !== 'KeyJ' || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || event.repeat) return
        event.preventDefault()
        event.stopPropagation()
        void jumpToNextWaiting().catch(openInbox)
      }
      window.addEventListener('keydown', onKeyDown, true)
      return () => window.removeEventListener('keydown', onKeyDown, true)
    }, 'activity-timeline: option-j')
    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 3, label, locale: ACTIVITY_TIMELINE_LOCALE_NAMESPACE }, PanelGlyph),
    )
    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: ACTIVITY_TIMELINE_LOCALE_NAMESPACE },
        decorate(props => (
          <PluginQueryProvider>
            <ActivityTimelinePanel sessions={ctx.sessions} uiWorkspace={ctx.uiWorkspace} workspaces={ctx.workspaces} t={props.t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
