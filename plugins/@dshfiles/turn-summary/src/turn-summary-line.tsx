import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useSettings } from '@dshfiles/dshx/client'
import { ChevronDownIcon, ChevronRightIcon, CircleXIcon, ListChecksIcon } from '@dshfiles/plugin-ui/icons'
import { useState, useSyncExternalStore } from 'react'
import { turnSummarySettings } from './settings.js'
import { TURN_ACTIVITY_KEY } from './turn-activity-node.js'
import { TurnActivity } from './turn-activity.js'

/** One line under a finished Turn: "ran 6 commands · 1 failed · edited 3 files", the failure count opening the list. */
export const TurnSummaryLine = (props: { readonly turn: TurnLocation }): JSX.Element | null => {
  const source = props.turn.data.source(TURN_ACTIVITY_KEY)
  const summary = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const settings = useSettings(turnSummarySettings).value
  const [open, setOpen] = useState(false)
  if (summary === undefined || settings?.enabled === false || TurnActivity.isEmpty(summary)) return null
  const parts = TurnActivity.parts(summary, { includeReads: settings?.includeReads !== false })
  if (parts.length === 0 && summary.failedCommands.length === 0) return null
  const failures = summary.failedCommands.length
  const canList = failures > 0 && settings?.listFailures !== false
  const sentence = parts.join(' · ')
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground" data-dshfiles-turn-summary="">
      <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
        <ListChecksIcon className="dshx:size-3.5 dshx:shrink-0" />
        <span className="dshx:min-w-0 dshx:truncate">{sentence.charAt(0).toUpperCase() + sentence.slice(1)}</span>
        {failures > 0 && (
          <button
            aria-expanded={canList ? open : undefined}
            className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-destructive dshx:disabled:cursor-default"
            disabled={!canList}
            onClick={() => setOpen(value => !value)}
            type="button"
          >
            <span aria-hidden>·</span>
            {failures} failed
            {canList && (open ? <ChevronDownIcon className="dshx:size-3" /> : <ChevronRightIcon className="dshx:size-3" />)}
          </button>
        )}
      </div>
      {canList && open && (
        <ul className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pl-5">
          {summary.failedCommands.map(failure => (
            <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" key={failure.callId}>
              <CircleXIcon className="dshx:size-3 dshx:shrink-0 dshx:text-destructive" />
              <span className="dshx:min-w-0 dshx:truncate dshx:font-mono">{failure.label}</span>
              <span className="dshx:shrink-0 dshx:text-destructive">{failure.outcome}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
