import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { buildGoToEntries, createDeferredNavigation, type GoToTarget } from './go-to.js'

type SessionTarget = GoToTarget<SessionSummary['id']>
import { SIDEBAR_COMMANDS_LOCALE_NAMESPACE, sidebarCommandsLocale } from './locales.js'

export default defineClient({
  name: '@dshfiles/sidebar-commands',
  locales: [sidebarCommandsLocale],
  // Every service is read when the popup opens or a row is picked, not at setup.
  inject: ['slots', 'commandUi', 'layout', 'sessions', 'uiWorkspace', 'workspaces'],
  setup(ctx) {
    const translate = ctx.locale.bind(SIDEBAR_COMMANDS_LOCALE_NAMESPACE)
    let targets = new Map<string, SessionTarget>()

    const PALETTE_EVENT = 'dshfiles:command-palette'
    const requestPalette = (detail: { mode: 'all' | 'threads' } | { probe: true }): boolean =>
      !window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail, cancelable: true }))

    const loadEntries = () => {
      const entries = buildGoToEntries({
        panels: ctx.slots.entriesOfSlot('sidebar.panellist').map(entry => ({ id: entry.options.id, label: resolveSlotLabel(entry.options.label) })),
        mainPanelKeys: new Set(ctx.slots.entriesOfSlot('main').flatMap(entry => entry.options.key ?? [])),
        sessions: ctx.sessions.list.getSnapshot(),
        archivedSessionIds: new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds),
        paletteAvailable: requestPalette({ probe: true }),
        copy: {
          actionsGroup: translate('actionsGroup'),
          actionDetail: translate('actionDetail'),
          paletteLabel: translate('paletteLabel'),
          threadSearchLabel: translate('threadSearchLabel'),
          panelsGroup: translate('panelsGroup'),
          sessionsGroup: translate('sessionsGroup'),
          panelDetail: translate('panelDetail'),
          sessionDetail: translate('sessionDetail'),
        },
      })
      targets = new Map(entries.map(entry => [entry.option.id, entry.target]))
      return entries.map(entry => entry.option)
    }

    const isStillAvailable = (target: SessionTarget): boolean => {
      if (target.kind === 'palette') return requestPalette({ probe: true })
      if (target.kind === 'panel') return ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === target.panelId)
      return ctx.sessions.list.getSnapshot().byId[target.sessionId] !== undefined
    }

    const open = (target: SessionTarget): void => {
      if (target.kind === 'palette') {
        requestPalette({ mode: target.mode })
        return
      }
      if (target.kind === 'panel') return ctx.layout.selectPanel(target.panelId)
      ctx.uiWorkspace.openSession(target.sessionId)
    }

    const select = createDeferredNavigation({
      isAvailable: isStillAvailable,
      unavailableMessage: target =>
        translate(target.kind === 'palette' ? 'paletteUnavailable' : target.kind === 'panel' ? 'panelUnavailable' : 'sessionUnavailable'),
      navigate: open,
      schedule: run => void setTimeout(run, 0),
    })

    ctx.effect(
      () =>
        ctx.commandUi.register({
          name: 'goto',
          label: () => translate('label'),
          description: () => translate('description'),
          available: () => true,
          ui: {
            kind: 'popupSelect',
            searchMode: 'fuzzy-label',
            searchLabels: () => ({ placeholder: translate('searchPlaceholder'), empty: translate('searchEmpty'), noResults: translate('searchNoResults') }),
            options: async (_session, signal) => (signal.aborted ? [] : loadEntries()),
            onSelect: option => {
              const target = targets.get(option.id)
              if (target !== undefined) select(target)
            },
          },
        }),
      'sidebar-commands: /goto',
    )
  },
})
