import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@dshfiles/plugin-ui/components/ui/radio-group'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { useApi } from '@dshfiles/dshx/client'
import { useState } from 'react'
import { jjIntegrationApi } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

export interface BookmarkConflictTarget {
  readonly commitId: string
  readonly summary: string
}

/** The confirm button's words: it names the revision it will keep, or asks for one while none is chosen. */
export const keepRevisionLabel = (input: { readonly bookmark: string; readonly chosen: string | null }) =>
  input.chosen === null
    ? ({ key: 'chooseConflictRevision', values: undefined } as const)
    : ({ key: 'keepBookmarkRevision', values: { bookmark: input.bookmark, revision: input.chosen.slice(0, 12) } } as const)

/**
 * Shown beside a refused thread workspace when the bookmark it starts from is conflicted: the user picks which revision
 * the bookmark keeps and confirms; nothing moves before that click. `onResolved` retries the move that was refused.
 */
export const BookmarkConflictAction = (props: {
  readonly path: string
  readonly bookmark: string | undefined
  /** Changes with each refusal, so a new refusal reads the bookmark again. */
  readonly refusal: string
  readonly onResolved: () => void
  readonly t: JjIntegrationTranslate
}) => {
  const { t } = props
  const api = useApi(jjIntegrationApi)
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const conflict = useQuery({
    queryKey: ['jj-integration', 'bookmark-conflict', props.path, props.bookmark ?? '', props.refusal],
    queryFn: ({ signal }) =>
      runHostRequest({
        signal,
        timeoutMs: 30_000,
        request: hostSignal =>
          api.bookmarkConflict(props.bookmark === undefined ? { path: props.path } : { path: props.path, bookmark: props.bookmark }, { signal: hostSignal }),
      }),
    retry: false,
  })
  const resolve = useMutation({
    mutationFn: (input: { readonly bookmark: string; readonly commitId: string }) =>
      runHostRequest({
        timeoutMs: 60_000,
        request: signal => api.resolveBookmarkConflict({ path: props.path, bookmark: input.bookmark, commitId: input.commitId, confirm: true }, { signal }),
      }),
    onSuccess: () => {
      setOpen(false)
      setChosen(null)
      props.onResolved()
    },
  })
  const data = conflict.data
  if (data === undefined || data.targets.length < 2) return null
  const bookmark = data.bookmark
  const confirmLabel = keepRevisionLabel({ bookmark, chosen })
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (resolve.isPending) return
        setOpen(next)
        if (!next) {
          setChosen(null)
          resolve.reset()
        }
      }}
    >
      <Button variant="outline" size="sm" className="dshx:h-11 dshx:sm:h-7" onClick={() => setOpen(true)}>
        {t('chooseBookmarkRevision', { bookmark })}
      </Button>
      <AlertDialogContent className="dshx:max-w-[calc(100vw-2rem)] dshx:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('bookmarkConflictTitle', { bookmark, count: data.targets.length })}</AlertDialogTitle>
          <AlertDialogDescription>{t('bookmarkConflictDescription', { bookmark })}</AlertDialogDescription>
        </AlertDialogHeader>
        <RadioGroup
          value={chosen ?? ''}
          onValueChange={value => setChosen(value)}
          aria-label={t('bookmarkConflictTitle', { bookmark, count: data.targets.length })}
          className="dshx:gap-2"
        >
          {data.targets.map(target => (
            <label
              key={target.commitId}
              className="dshx:flex dshx:min-h-11 dshx:cursor-pointer dshx:items-center dshx:gap-3 dshx:rounded-md dshx:border dshx:px-3 dshx:py-2 dshx:text-sm"
            >
              <RadioGroupItem value={target.commitId} />
              <span className="dshx:font-mono dshx:text-xs">{target.commitId.slice(0, 12)}</span>
              <span className="dshx:min-w-0 dshx:truncate">{target.summary === '' ? t('noRevisionDescription') : target.summary}</span>
            </label>
          ))}
        </RadioGroup>
        {resolve.isError ? (
          <p role="alert" className="dshx:text-sm dshx:text-destructive">
            {errorMessage(resolve.error, t('bookmarkConflictFailed', { bookmark }))}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel className="dshx:h-11 dshx:sm:h-9" disabled={resolve.isPending}>
            {t('cancel')}
          </AlertDialogCancel>
          <Button
            className="dshx:h-11 dshx:sm:h-9"
            disabled={chosen === null || resolve.isPending}
            onClick={() => {
              if (chosen !== null) resolve.mutate({ bookmark, commitId: chosen })
            }}
          >
            {resolve.isPending ? <Spinner /> : null}
            {confirmLabel.values === undefined ? t(confirmLabel.key) : t(confirmLabel.key, confirmLabel.values)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
