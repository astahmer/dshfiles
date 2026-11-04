import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { createApiClient, defineClient } from '@dshfiles/dshx/client'
import { GitPullRequestIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useSyncExternalStore, type ReactNode } from 'react'
import { pullRequestApi } from './api.js'
import { CreatePullRequestDialog, type CreateDialogApi, type Translate } from './create-dialog.js'
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
  inject: ['slots'],
  setup(ctx, _decorate, metadata) {
    const t: Translate = (key, params) => ctx.locale.bind(PULL_REQUESTS_LOCALE_NAMESPACE)(key, params)
    const api = createApiClient(ctx, pullRequestApi)
    const dialogApi: CreateDialogApi = {
      preview: (input, signal) => api.createPreview(input, { signal }),
      create: input => api.create(input),
    }
    const target = createTargetStore()

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
