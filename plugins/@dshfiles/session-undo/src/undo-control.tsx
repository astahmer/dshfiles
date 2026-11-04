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
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { History, Redo2, Undo2 } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { sessionUndoApi } from './api.js'

type Key =
  | 'undo'
  | 'undoTurn'
  | 'undoTurnNoFiles'
  | 'redo'
  | 'untitledTurn'
  | 'failed'
  | 'rewind'
  | 'rewindMenu'
  | 'rewindHere'
  | 'turnLabel'
  | 'untitledPrompt'
  | 'confirmTitle'
  | 'confirmLost'
  | 'confirmFiles'
  | 'confirmNoFiles'
  | 'confirmRedo'
  | 'confirmAction'
  | 'cancel'
  | 'sharedTitle'
  | 'anywayUndo'
  | 'anywayRewind'
  | 'anywayRedo'

interface UndoControlProps {
  readonly sessionId: string
  readonly openSession: (sessionId: string) => void
  readonly t: Translate<Key>
}

type Verb = 'undo' | 'rewind' | 'redo'
interface Move {
  readonly verb: Verb
  readonly turn?: number
  readonly allowSharedDirectory?: true
}
/** The rewind confirmation, or the shared-folder refusal a move came back with and its "anyway" retry. */
type Dialog = { readonly kind: 'confirm'; readonly turn: number } | { readonly kind: 'shared'; readonly move: Move; readonly message: string }

const ANYWAY = { undo: 'anywayUndo', rewind: 'anywayRewind', redo: 'anywayRedo' } as const satisfies Record<Verb, Key>
const SHARED_CODES = new Set(['shared-directory', 'shared-directory-unknown'])
/** The Host's shared-folder refusals, by the wire code dshx carries over as `remoteCode`. */
const sharedRefusal = (error: unknown): boolean => isApiError(error) && error.remoteCode !== undefined && SHARED_CODES.has(error.remoteCode)

const short = (prompt: string, max: number): string => (prompt.length > max ? `${prompt.slice(0, max - 1)}…` : prompt)

/** The newest checkpoint of a turn: a fork may record a turn number again after a rewind. */
const lastIndexOf = (checkpoints: readonly { readonly turn: number }[], turn: number): number => {
  for (let index = checkpoints.length - 1; index >= 0; index -= 1) if (checkpoints[index]?.turn === turn) return index
  return -1
}

/**
 * Composer control: undo the thread's last turn (conversation and files), rewind to before any recorded turn after a
 * confirmation that lists the turns it drops, and redo while the undo or rewind is fresh. A shared-folder refusal
 * opens a dialog that names the other thread and offers the explicit "anyway" retry.
 */
export const UndoControl = (props: UndoControlProps): JSX.Element | null => {
  const api = useApi(sessionUndoApi)
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const history = useQuery({
    queryKey: ['session-undo', 'history', props.sessionId],
    queryFn: ({ signal }) => api.history({ sessionId: props.sessionId }, { signal }),
    refetchInterval: 15_000,
    retry: false,
  })
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
  const last = checkpoints.at(-1)
  const redoTo = history.data?.redoTo ?? null
  if (last === undefined && redoTo === null) return null
  const prompt = last?.prompt === '' || last === undefined ? props.t('untitledTurn') : short(last.prompt, 60)
  const confirmIndex = dialog?.kind === 'confirm' ? lastIndexOf(checkpoints, dialog.turn) : -1
  const rewound = confirmIndex === -1 ? [] : checkpoints.slice(confirmIndex)
  const target = rewound[0]
  return (
    <TooltipProvider>
      <span className="dshx-root dshx:inline-flex dshx:items-center" data-session-undo="control">
        {last === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('undo')}
                data-session-undo="undo"
                disabled={move.isPending}
                className="dshx:text-muted-foreground dshx:hover:text-foreground"
                onClick={() => move.mutate({ verb: 'undo' })}
                onMouseDown={event => event.preventDefault()}
                size="icon-sm"
                variant="ghost"
              >
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{failure ?? props.t(last.files ? 'undoTurn' : 'undoTurnNoFiles', { prompt })}</TooltipContent>
          </Tooltip>
        )}
        {checkpoints.length < 2 ? null : (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={props.t('rewind')}
                    data-session-undo="rewind"
                    disabled={move.isPending}
                    className="dshx:text-muted-foreground dshx:hover:text-foreground"
                    onMouseDown={event => event.preventDefault()}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <History />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{failure ?? props.t('rewind')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="dshx:w-72">
              <DropdownMenuLabel>{props.t('rewindMenu')}</DropdownMenuLabel>
              {[...checkpoints].reverse().map(checkpoint => (
                <DropdownMenuItem
                  key={`${String(checkpoint.turn)}-${String(checkpoint.at)}`}
                  aria-label={`${props.t('rewindHere')} · ${props.t('turnLabel', { turn: checkpoint.turn })}`}
                  data-session-undo-turn={checkpoint.turn}
                  onSelect={() => setDialog({ kind: 'confirm', turn: checkpoint.turn })}
                  className="dshx:flex dshx:flex-col dshx:items-start dshx:gap-0.5"
                >
                  <span className="dshx:text-xs dshx:text-muted-foreground">
                    {props.t('turnLabel', { turn: checkpoint.turn })} · {props.t('rewindHere')}
                  </span>
                  <span className="dshx:w-full dshx:truncate">{checkpoint.prompt === '' ? props.t('untitledPrompt') : short(checkpoint.prompt, 80)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {redoTo === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('redo')}
                data-session-undo="redo"
                disabled={move.isPending}
                onClick={() => move.mutate({ verb: 'redo' })}
                size="icon-sm"
                variant="ghost"
              >
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{failure ?? props.t('redo')}</TooltipContent>
          </Tooltip>
        )}
      </span>
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
    </TooltipProvider>
  )
}
