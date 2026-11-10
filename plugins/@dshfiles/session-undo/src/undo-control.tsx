import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { History, Redo2, Undo2 } from '@dshfiles/plugin-ui/icons'
import type { SessionUndoKey } from './locales.js'
import { short, useRewindFlow, useUndoHistory } from './rewind-flow.js'

interface UndoControlProps {
  readonly sessionId: string
  readonly openSession: (sessionId: string) => void
  readonly t: Translate<SessionUndoKey>
}

/**
 * Composer control: undo the thread's last turn (conversation and files), rewind to before any recorded turn after a
 * confirmation that lists the turns it drops, and redo while the undo or rewind is fresh.
 */
export const UndoControl = (props: UndoControlProps): JSX.Element | null => {
  const history = useUndoHistory(props.sessionId)
  const flow = useRewindFlow(props)
  const checkpoints = history.data?.checkpoints ?? []
  const last = checkpoints.at(-1)
  const redoTo = history.data?.redoTo ?? null
  if (last === undefined && redoTo === null) return null
  const prompt = last?.prompt === '' || last === undefined ? props.t('untitledTurn') : short(last.prompt, 60)
  return (
    <TooltipProvider>
      <span className="dshx-root dshx:inline-flex dshx:items-center" data-session-undo="control">
        {last === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={props.t('undo')}
                data-session-undo="undo"
                disabled={flow.pending}
                className="dshx:text-muted-foreground dshx:hover:text-foreground"
                onClick={() => flow.run({ verb: 'undo' })}
                onMouseDown={event => event.preventDefault()}
                size="icon-sm"
                variant="ghost"
              >
                <Undo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{flow.failure ?? props.t(last.files ? 'undoTurn' : 'undoTurnNoFiles', { prompt })}</TooltipContent>
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
                    disabled={flow.pending}
                    className="dshx:text-muted-foreground dshx:hover:text-foreground"
                    onMouseDown={event => event.preventDefault()}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <History />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{flow.failure ?? props.t('rewind')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="dshx:w-72">
              <DropdownMenuLabel>{props.t('rewindMenu')}</DropdownMenuLabel>
              {[...checkpoints].reverse().map(checkpoint => (
                <DropdownMenuItem
                  key={`${String(checkpoint.turn)}-${String(checkpoint.at)}`}
                  aria-label={`${props.t('rewindHere')} · ${props.t('turnLabel', { turn: checkpoint.turn })}`}
                  data-session-undo-turn={checkpoint.turn}
                  onSelect={() => flow.confirmRewind(checkpoint.turn)}
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
                disabled={flow.pending}
                onClick={() => flow.run({ verb: 'redo' })}
                size="icon-sm"
                variant="ghost"
              >
                <Redo2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{flow.failure ?? props.t('redo')}</TooltipContent>
          </Tooltip>
        )}
      </span>
      {flow.dialog}
    </TooltipProvider>
  )
}
