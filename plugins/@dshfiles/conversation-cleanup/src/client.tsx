import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'
import { useCallback, useSyncExternalStore } from 'react'
import { PluginQueryProvider, errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { cleanupApi, previewSchema, receiptSchema } from './cleanup-api.js'
import { cleanupLocale, type CleanupTranslate } from './locales.js'

/**
 * A thread's title (b:ysaj): its display title, else "Untitled thread · <project>", never the raw Session id, which
 * stays in the row's tooltip.
 */
const useThreadName = (sessions: ISessions, workspaces: IWorkspaces, t: CleanupTranslate): ((sessionId: string) => string) => {
  const snapshot = useSyncExternalStore(
    useCallback(listener => sessions.list.subscribe(listener), [sessions]),
    () => sessions.list.getSnapshot(),
  )
  const project = EntityLabels.useWorkspaceLabel(workspaces)
  return useCallback(
    (sessionId: string) => {
      const summary = snapshot.byId[SessionId(sessionId)]
      const title = summary?.displayTitle?.trim() ?? ''
      if (title !== '') return title
      return summary?.cwd === undefined || summary.cwd === null ? t('untitled') : `${t('untitled')} · ${project({ path: summary.cwd })}`
    },
    [project, snapshot, t],
  )
}

const CleanupSection = (props: { readonly t: CleanupTranslate; readonly sessions: ISessions; readonly workspaces: IWorkspaces }): JSX.Element => {
  const api = useApi(cleanupApi)
  const threadName = useThreadName(props.sessions, props.workspaces, props.t)
  const preview = useMutation({ mutationFn: async () => Schema.decodeUnknownSync(previewSchema)(await api.preview({})) })
  const deletion = useMutation({
    mutationFn: async (previewId: string) => Schema.decodeUnknownSync(receiptSchema)(await api.delete({ previewId, confirm: true })),
    onSettled: () => preview.reset(),
  })
  const busy = preview.isPending || deletion.isPending
  const t = props.t
  return (
    <TooltipProvider>
      <section className="dshx-root dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-4 dshx:p-5">
        <h2 className="dshx:text-lg dshx:font-semibold">{t('title')}</h2>
        <p>{t('description')}</p>
        <p className="dshx:rounded-md dshx:border dshx:p-3 dshx:text-sm">{t('safety')}</p>
        <p className="dshx:text-sm dshx:text-muted-foreground">{t('scope')}</p>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              deletion.reset()
              preview.mutate()
            }}
          >
            {t(preview.isPending ? 'preparing' : 'preview')}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={busy || preview.data === undefined || preview.data.candidates.length === 0}>
                {t(deletion.isPending ? 'deleting' : 'delete')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="dshx-root" size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>{t('confirmDescription')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    if (preview.data !== undefined) deletion.mutate(preview.data.previewId)
                  }}
                >
                  {t('confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {(preview.error ?? deletion.error) !== null && (
          <p role="alert" className="dshx:text-destructive">
            {errorMessage(preview.error ?? deletion.error, t('error'))}
          </p>
        )}
        {preview.data !== undefined && (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2" aria-live="polite">
            <p>
              <span>{t('candidates')}</span>: {preview.data.candidates.length}
            </p>
            <p className="dshx:text-sm dshx:text-muted-foreground">
              {t('protected')}: {preview.data.protectedCount}
            </p>
            {preview.data.remainingCount > 0 && (
              <p>
                {t('remaining')}: {preview.data.remainingCount}
              </p>
            )}
            {preview.data.candidates.length === 0 && <p>{t('empty')}</p>}
            <ul className="dshx:max-h-72 dshx:overflow-auto dshx:rounded-md dshx:border dshx:border-border">
              {preview.data.candidates.map(candidate => (
                <li
                  key={candidate.sessionId}
                  className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-2 dshx:border-b dshx:border-border dshx:p-2 dshx:text-sm dshx:last:border-b-0"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate" data-cleanup-candidate={candidate.sessionId} tabIndex={0}>
                        {threadName(candidate.sessionId)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="dshx:font-mono!">{candidate.sessionId}</TooltipContent>
                  </Tooltip>
                  <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">
                    {[candidate.archived ? t('archived') : '', candidate.settled ? t('settled') : ''].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {deletion.data !== undefined && (
          <div aria-live="polite">
            <h3 className="dshx:font-medium">{t('results')}</h3>
            <ul>
              {deletion.data.results.map(result => (
                <li key={result.sessionId} className="dshx:py-2 dshx:text-sm">
                  {t(result.status)} · <span data-cleanup-result={result.sessionId}>{threadName(result.sessionId)}</span>
                  <p className="dshx:text-muted-foreground">{result.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </TooltipProvider>
  )
}

export default defineClient({
  name: '@dshfiles/conversation-cleanup',
  locales: [cleanupLocale],
  inject: ['slots', 'sessions', 'workspaces'],
  setup(ctx, decorate) {
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/conversation-cleanup',
          id: 'dshfiles-conversation-cleanup',
          order: 42,
          locale: 'dshfiles.conversation-cleanup',
          label: () => ctx.locale.bind('dshfiles.conversation-cleanup')('title'),
        },
        decorate(({ t }: { readonly t: CleanupTranslate }) => (
          <PluginQueryProvider>
            <CleanupSection t={t} sessions={ctx.sessions} workspaces={ctx.workspaces} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
