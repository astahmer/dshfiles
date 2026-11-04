import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { defineClient, Overlay } from '@dshfiles/dshx/client'
import { DownloadIcon, FileUpIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { ThreadRowActions } from '@dshfiles/thread-sidebar/thread-row-actions'
import { useSyncExternalStore } from 'react'
import { THREAD_TRANSFER_LOCALE, threadTransferLocale } from './locales.js'
import { TransferDialog, type TransferRequest } from './transfer-dialog.js'

const PACKAGE_ID = '@dshfiles/thread-transfer'

/** The one open transfer dialog of this page, shared by every entry point. */
const createRequestStore = () => {
  let current: TransferRequest | null = null
  const listeners = new Set<() => void>()
  return {
    get: (): TransferRequest | null => current,
    set: (next: TransferRequest | null): void => {
      current = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export default defineClient({
  name: PACKAGE_ID,
  locales: [threadTransferLocale],
  inject: ['uiWorkspace', 'sessions'],
  setup(ctx, _decorate, metadata) {
    const t = ctx.locale.bind(THREAD_TRANSFER_LOCALE)
    const plugin = metadata?.plugin
    if (plugin === undefined) return
    const request = createRequestStore()

    plugin.add(Overlay, {
      id: 'dshfiles-thread-transfer',
      component: () => {
        const open = useSyncExternalStore(request.subscribe, request.get, request.get)
        return (
          <PluginQueryProvider>
            <TransferDialog
              close={() => request.set(null)}
              openSession={async sessionId => {
                // The import stored the thread behind this page's list: refresh it before opening the new row.
                await ctx.sessions.refresh()
                ctx.uiWorkspace.openSession(SessionId(sessionId))
              }}
              request={open}
              t={t}
            />
          </PluginQueryProvider>
        )
      },
    })

    plugin.add(ThreadRowActions, {
      id: `${PACKAGE_ID}/export`,
      label: () => t('exportAction'),
      order: 10,
      run: target => request.set({ kind: 'export', sessionId: target.sessionId }),
    })

    plugin.add(PaletteActions, {
      id: `${PACKAGE_ID}/export`,
      label: () => t('exportPalette'),
      aliases: ['export thread', 'share thread', 'download thread', 'dshthread'],
      icon: <DownloadIcon className="dshx:size-4" />,
      group: 'action',
      isAvailable: context => context.thread !== null,
      run: context => {
        if (context.thread !== null) request.set({ kind: 'export', sessionId: context.thread.id })
      },
    })

    plugin.add(PaletteActions, {
      id: `${PACKAGE_ID}/import`,
      label: () => t('importPalette'),
      aliases: ['import thread', 'open dshthread', 'load thread', 'restore thread'],
      icon: <FileUpIcon className="dshx:size-4" />,
      group: 'action',
      run: context => request.set({ kind: 'import', workspaceId: context.workspace?.id }),
    })
  },
})
