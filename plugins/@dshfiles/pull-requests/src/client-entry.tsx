import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { GitPullRequestIcon } from '@dshfiles/plugin-ui/icons'
import { LandCardActions } from '@dshfiles/diffs-review/land-card-actions'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore, type ReactNode } from 'react'
import { pullRequestApi } from './api.js'
import { ForgeMentions } from './forge-mentions.js'
import { CreatePullRequestDialog, type CreateDialogApi, type Translate } from './create-dialog.js'
import { createLandCardAction } from './land-card-action.js'
import { PULL_REQUESTS_LOCALE_NAMESPACE, pullRequestsLocale } from './locales.js'

interface CreateTarget {
  readonly sessionId: string
  readonly title: string
}

/** The thread the create dialog is open for; the palette sets it, the overlay reads it. */
const createTargetStore = () => {
  let current: CreateTarget | null = null
  const listeners = new Set<() => void>()
  return {
    getSnapshot: (): CreateTarget | null => current,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: CreateTarget | null): void => {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

export default defineClient({
  name: '@dshfiles/pull-requests',
  locales: [pullRequestsLocale],
  inject: ['slots', 'sessions', 'inputTriggers'],
  setup(ctx, _decorate, metadata) {
    const t: Translate = (key, params) => ctx.locale.bind(PULL_REQUESTS_LOCALE_NAMESPACE)(key, params)
    const api = createApiClient(ctx, pullRequestApi)
    const dialogApi: CreateDialogApi = {
      preview: (input, signal) => api.createPreview(input, { signal }),
      create: input => api.create(input),
    }
    const target = createTargetStore()
    const forgeMentions = ForgeMentions.create({
      search: async (sessionId, query, signal) => {
        const session = Object.values(ctx.sessions.list.getSnapshot().byId).find(candidate => candidate?.id === sessionId)
        if (session?.cwd === undefined || !/^[\p{L}\p{N} _.-]*$/u.test(query)) return { items: [] }
        try {
          // gh missing or signed out comes back as `unavailable`, which the picker turns into one recovery row; any
          // other failure (no GitHub remote: not a forge) and an older Host's error keep the list empty.
          return await api.search({ cwd: session.cwd, query }, { signal })
        } catch {
          return { items: [] }
        }
      },
    })
    ctx.effect(() => ctx.inputTriggers.registerSource(forgeMentions), 'pull-requests: forge mentions')

    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'dshfiles-pull-requests-create', order: 112, locale: PULL_REQUESTS_LOCALE_NAMESPACE },
            (_props: PropsRuntime<'shell.overlay'>): ReactNode => {
              const open = useSyncExternalStore(target.subscribe, target.getSnapshot)
              if (open === null) return null
              return (
                <PluginQueryProvider>
                  <CreatePullRequestDialog
                    key={open.sessionId}
                    sessionId={open.sessionId}
                    threadTitle={open.title}
                    api={dialogApi}
                    t={t}
                    onClose={() => target.set(null)}
                  />
                </PluginQueryProvider>
              )
            },
          ),
        ),
      'dshfiles-pull-requests: create dialog',
    )

    const plugin = metadata?.plugin
    if (plugin !== undefined) {
      // Open PR beside Land on diffs-review's Land card; the card renders nothing of ours when this plugin is absent.
      const OpenPullRequestAction = createLandCardAction({
        list: async (sessionId, signal) => (await api.list({ sessionId }, { signal })).links,
        openCreate: next => target.set(next),
        dialogOpen: { subscribe: target.subscribe, get: () => target.getSnapshot() !== null },
      })
      ctx.effect(
        () => plugin.add(LandCardActions, { id: '@dshfiles/pull-requests', order: 10, component: plugin.bind(OpenPullRequestAction) }),
        'dshfiles-pull-requests: Open PR on the Land card',
      )
    }

    metadata?.plugin?.add(PaletteActions, {
      id: '@dshfiles/pull-requests/create',
      label: () => t('paletteCreate'),
      aliases: ['pull request', 'pr', 'open pr', 'create pr', 'github', 'push'],
      icon: <GitPullRequestIcon className="dshx:size-4" />,
      group: 'action',
      isAvailable: context => context.thread !== null && !context.thread.archived,
      run: context => {
        if (context.thread !== null) target.set({ sessionId: context.thread.id, title: context.thread.title })
      },
    })
  },
})
