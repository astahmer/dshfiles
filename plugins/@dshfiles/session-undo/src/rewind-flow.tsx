import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { isApiError } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { CheckpointGraph } from '@dshfiles/plugin-ui/components/motion/checkpoint-graph'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState, type ReactNode } from 'react'
import { sessionUndoApi } from './api.js'
import type { SessionUndoKey } from './locales.js'
import { rewindPreview } from './rewind-preview.js'

type Verb = 'undo' | 'rewind' | 'redo'
export interface Move {
  readonly verb: Verb
  readonly turn?: number
  readonly allowSharedDirectory?: true
}
/** The rewind confirmation, or the shared-folder refusal a move came back with and its "anyway" retry. */
type Dialog = { readonly kind: 'confirm'; readonly turn: number } | { readonly kind: 'shared'; readonly move: Move; readonly message: string }

const ANYWAY = { undo: 'anywayUndo', rewind: 'anywayRewind', redo: 'anywayRedo' } as const satisfies Record<Verb, SessionUndoKey>
const SHARED_CODES = new Set(['shared-directory', 'shared-directory-unknown'])
/** The Host's shared-folder refusals, by the wire code dshx carries over as `remoteCode`. */
const sharedRefusal = (error: unknown): boolean => isApiError(error) && error.remoteCode !== undefined && SHARED_CODES.has(error.remoteCode)

export const short = (prompt: string, max: number): string => (prompt.length > max ? `${prompt.slice(0, max - 1)}…` : prompt)

/** The newest checkpoint of a turn: a fork may record a turn number again after a rewind. */
export const lastIndexOf = (checkpoints: readonly { readonly turn: number }[], turn: number): number => {
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) if (checkpoints[index]?.turn === turn) return index
  return -1
}

export const historyQueryKey = (sessionId: string) => ['session-undo', 'history', sessionId] as const

/** The thread's recorded turns; every control of one thread shares this query. */
export const useUndoHistory = (sessionId: string) => {
  const api = useApi(sessionUndoApi)
  return useQuery({
    queryKey: historyQueryKey(sessionId),
    queryFn: ({ signal }) => api.history({ sessionId }, { signal }),
    refetchInterval: 15_000,
    retry: false,
  })
}

/**
 * Undo, rewind and redo with their dialogs: a rewind asks first and lists the turns it drops, and a shared-folder
 * refusal names the other thread and offers the explicit "anyway" retry. `dialog` renders both; mount it once.
 */
export const useRewindFlow = (props: {
  readonly sessionId: string
  readonly openSession: (sessionId: string) => void
  readonly t: Translate<SessionUndoKey>
}): {
  readonly pending: boolean
  readonly failure: string | null
  readonly run: (move: Move) => void
  readonly confirmRewind: (turn: number) => void
  readonly dialog: ReactNode
} => {
  const api = useApi(sessionUndoApi)
  const queryClient = useQueryClient()
  const history = useUndoHistory(props.sessionId)
  const [failure, setFailure] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const move = useMutation({
    mutationFn: (input: Move) => {
      const shared = input.allowSharedDirectory === undefined ? {} : { allowSharedDirectory: input.allowSharedDirectory }
      if (input.verb === 'redo') return api.redo({ sessionId: props.sessionId, ...shared })
      if (input.verb === 'rewind' && input.turn !== undefined) return api.rewind({ sessionId: props.sessionId, turn: input.turn, confirm: true, ...shared })
      return api.undo({ sessionId: props.sessionId, confirm: true, ...shared })
    },
    onSuccess: result => {
      setFailure(null)
      setDialog(null)
      void queryClient.invalidateQueries({ queryKey: ['session-undo', 'history'] })
      props.openSession(result.sessionId)
    },
    onError: (error, input) => {
      const message = errorMessage(error, input.verb)
      if (sharedRefusal(error) && input.allowSharedDirectory === undefined) {
        setDialog({ kind: 'shared', move: input, message })
        return
      }
      setDialog(null)
      setFailure(props.t('failed', { verb: input.verb, message }))
    },
  })
  const checkpoints = history.data?.checkpoints ?? []
  const confirmIndex = dialog?.kind === 'confirm' ? lastIndexOf(checkpoints, dialog.turn) : -1
  const rewound = confirmIndex === -1 ? [] : checkpoints.slice(confirmIndex)
  const target = rewound[0]
  const preview =
    target === undefined ? [] : rewindPreview(checkpoints, confirmIndex, { untitled: props.t('untitledPrompt'), files: props.t('checkpointFiles') })
  const element = (
    <AlertDialog
      open={dialog !== null}
      onOpenChange={open => {
        if (!open && !move.isPending) setDialog(null)
      }}
    >
      <AlertDialogContent data-session-undo="dialog">
        {dialog?.kind === 'shared' ? (
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t('sharedTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.message}</AlertDialogDescription>
          </AlertDialogHeader>
        ) : target === undefined ? null : (
          <AlertDialogHeader>
            <AlertDialogTitle>{props.t('confirmTitle', { turn: target.turn })}</AlertDialogTitle>
            <AlertDialogDescription>{props.t('confirmLost', { count: rewound.length })}</AlertDialogDescription>
            <ul
              className="dshx:max-h-48 dshx:list-disc dshx:space-y-1 dshx:overflow-y-auto dshx:pl-5 dshx:text-left dshx:text-sm"
              data-session-undo="lost-turns"
            >
              {rewound.map(checkpoint => (
                <li key={`${String(checkpoint.turn)}-${String(checkpoint.at)}`} className="dshx:break-words">
                  <span className="dshx:text-muted-foreground">{props.t('turnLabel', { turn: checkpoint.turn })}:</span>{' '}
                  {checkpoint.prompt === '' ? props.t('untitledPrompt') : short(checkpoint.prompt, 140)}
                </li>
              ))}
            </ul>
            <div
              className="dshx:max-h-48 dshx:min-w-0 dshx:overflow-y-auto dshx:overscroll-contain dshx:rounded-md dshx:border dshx:border-border dshx:px-2 dshx:pb-1 dshx:text-left"
              data-session-undo="rewind-preview"
            >
              <CheckpointGraph checkpoints={preview} selectedId={preview[confirmIndex - 1]?.id} />
            </div>
            <p className="dshx:text-left dshx:text-sm">{props.t(target.files ? 'confirmFiles' : 'confirmNoFiles', { turn: target.turn })}</p>
            <p className="dshx:text-left dshx:text-sm dshx:text-muted-foreground">{props.t('confirmRedo')}</p>
          </AlertDialogHeader>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={move.isPending}>{props.t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={move.isPending}
            onClick={event => {
              event.preventDefault()
              if (dialog?.kind === 'shared') move.mutate({ ...dialog.move, allowSharedDirectory: true })
              else if (target !== undefined) move.mutate({ verb: 'rewind', turn: target.turn })
            }}
          >
            {dialog?.kind === 'shared' ? props.t(ANYWAY[dialog.move.verb]) : props.t('confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return {
    pending: move.isPending,
    failure,
    run: input => move.mutate(input),
    confirmRewind: turn => setDialog({ kind: 'confirm', turn }),
    dialog: element,
  }
}
