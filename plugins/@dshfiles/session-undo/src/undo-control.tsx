import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Redo2, Undo2 } from '@dshfiles/plugin-ui/icons'
import { errorMessage, useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useState } from 'react'
import { sessionUndoApi } from './api.js'

interface UndoControlProps {
  readonly sessionId: string
  readonly openSession: (sessionId: string) => void
  readonly t: Translate<'undo' | 'undoTurn' | 'undoTurnNoFiles' | 'redo' | 'untitledTurn' | 'failed'>
}

/** Composer control: undo the thread's last turn (conversation and files), and redo while the undo is fresh. */
export const UndoControl = (props: UndoControlProps): JSX.Element | null => {
  const api = useApi(sessionUndoApi)
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<string | null>(null)
  const history = useQuery({
    queryKey: ['session-undo', 'history', props.sessionId],
    queryFn: ({ signal }) => api.history({ sessionId: props.sessionId }, { signal }),
    refetchInterval: 15_000,
    retry: false,
  })
  const move = useMutation({
    mutationFn: (verb: 'undo' | 'redo') =>
      verb === 'undo' ? api.undo({ sessionId: props.sessionId, confirm: true }) : api.redo({ sessionId: props.sessionId }),
    onSuccess: result => {
      setFailure(null)
      void queryClient.invalidateQueries({ queryKey: ['session-undo', 'history'] })
      props.openSession(result.sessionId)
    },
    onError: (error, verb) => setFailure(props.t('failed', { verb, message: errorMessage(error, verb) })),
  })
  const last = history.data?.checkpoints.at(-1)
  const redoTo = history.data?.redoTo ?? null
  if (last === undefined && redoTo === null) return null
  const prompt = last?.prompt === '' || last === undefined ? props.t('untitledTurn') : last.prompt.length > 60 ? `${last.prompt.slice(0, 57)}…` : last.prompt
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
                onClick={() => move.mutate('undo')}
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
        {redoTo === null ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('redo')}
                data-session-undo="redo"
                disabled={move.isPending}
                onClick={() => move.mutate('redo')}
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
    </TooltipProvider>
  )
}
