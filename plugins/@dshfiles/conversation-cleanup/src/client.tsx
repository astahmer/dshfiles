import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
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
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { PluginQueryProvider, errorMessage, useMutation } from '@dshfiles/plugin-ui/query'
import { Schema } from 'effect'
import { cleanupApi, previewSchema, receiptSchema } from './cleanup-api.js'
import { cleanupLocale, type CleanupTranslate } from './locales.js'

const CleanupSection = (props: { readonly t: CleanupTranslate }): JSX.Element => {
  const api = useApi(cleanupApi)
  const preview = useMutation({ mutationFn: async () => Schema.decodeUnknownSync(previewSchema)(await api.preview({})) })
  const deletion = useMutation({
    mutationFn: async (previewId: string) => Schema.decodeUnknownSync(receiptSchema)(await api.delete({ previewId, confirm: true })),
    onSettled: () => preview.reset(),
  })
  const busy = preview.isPending || deletion.isPending
  const t = props.t
  return (
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
          <ul className="dshx:max-h-72 dshx:overflow-auto dshx:rounded-md dshx:border">
            {preview.data.candidates.map(candidate => (
              <li key={candidate.sessionId} className="dshx:min-w-0 dshx:border-b dshx:p-2 dshx:text-sm">
                <code className="dshx:break-all">{candidate.sessionId}</code>
                <span className="dshx:ml-2 dshx:text-muted-foreground">
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
              <li key={result.sessionId} className="dshx:break-all dshx:py-2 dshx:text-sm">
                {t(result.status)} · <code>{result.sessionId}</code>
                <p className="dshx:text-muted-foreground">{result.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export default defineClient({
  name: '@dshfiles/conversation-cleanup',
  locales: [cleanupLocale],
  inject: ['slots'],
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
            <CleanupSection t={t} />
          </PluginQueryProvider>
        )),
      ),
    )
  },
})
