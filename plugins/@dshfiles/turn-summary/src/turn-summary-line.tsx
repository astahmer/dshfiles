import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useSettings } from '@dshfiles/dshx/client'
import { ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, FileIcon, ListChecksIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { Fragment, useState, useSyncExternalStore, type ReactNode } from 'react'
import { turnSummarySettings } from './settings.js'
import { TURN_ACTIVITY_KEY } from './turn-activity-node.js'
import { TurnActivity, type TurnActivitySummary, type TurnSegment } from './turn-activity.js'
import { TurnWalkthrough } from './turn-walkthrough.js'

type OpenList = 'files' | 'commands' | 'failures'

const Toggle = (props: { readonly open: boolean; readonly onToggle: () => void; readonly className?: string; readonly children: ReactNode }): JSX.Element => (
  <button
    aria-expanded={props.open}
    className={cn('dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:hover:text-foreground', props.className)}
    onClick={props.onToggle}
    type="button"
  >
    {props.children}
    {props.open ? <ChevronDownIcon aria-hidden className="dshx:size-3" /> : <ChevronRightIcon aria-hidden className="dshx:size-3" />}
  </button>
)

const FileList = (props: { readonly summary: TurnActivitySummary; readonly openFile: (path: string) => void }): JSX.Element => (
  <ul aria-label="Edited files" className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pl-5">
    {props.summary.editedFileStats.map(file => (
      <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" key={file.path}>
        <FileIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
        <button
          className="dshx:min-w-0 dshx:truncate dshx:font-mono dshx:hover:text-foreground dshx:hover:underline"
          onClick={() => props.openFile(file.path)}
          type="button"
        >
          {file.path}
        </button>
        {file.added + file.removed > 0 && (
          <span className="dshx:shrink-0 dshx:tabular-nums">
            <span className="dshx:text-success">+{file.added}</span> <span className="dshx:text-destructive">−{file.removed}</span>
          </span>
        )}
      </li>
    ))}
  </ul>
)

const CommandList = (props: { readonly summary: TurnActivitySummary; readonly onlyFailed: boolean }): JSX.Element => {
  const rows = props.onlyFailed ? props.summary.failedCommands : props.summary.commandRuns
  return (
    <ul aria-label={props.onlyFailed ? 'Failed commands' : 'Commands'} className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pl-5">
      {rows.map(row => {
        const failed = row.outcome !== undefined && row.outcome !== 'ok'
        return (
          <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" key={row.callId}>
            {failed ? (
              <CircleXIcon aria-hidden className="dshx:size-3 dshx:shrink-0 dshx:text-destructive" />
            ) : (
              <CircleCheckIcon aria-hidden className="dshx:size-3 dshx:shrink-0" />
            )}
            <span className="dshx:min-w-0 dshx:truncate dshx:font-mono">{row.label}</span>
            {failed && <span className="dshx:shrink-0 dshx:text-destructive">{row.outcome}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The footer under a finished Turn: "Edited 3 files +42 −7 · ran 6 commands · 1 failed · tests 40/42 · 1m 12s". The
 * file and command counts open their lists (each file opens in the editor), and the failure count opens the failures.
 * When the walkthrough card shows, the edited files appear only in that card.
 */
export const TurnSummaryLine = (props: {
  readonly turn: TurnLocation
  readonly openFile: (path: string) => void
  /** Opens this turn's changed-files review at the `workspace/changes` sequence that addresses it. */
  readonly openChanges: (input: { readonly seq: number; readonly turn: number }) => void
}): JSX.Element | null => {
  const source = props.turn.data.source(TURN_ACTIVITY_KEY)
  const summary = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const settings = useSettings(turnSummarySettings).value
  const [open, setOpen] = useState<OpenList | undefined>(undefined)
  if (summary === undefined || settings?.enabled === false || TurnActivity.isEmpty(summary)) return null
  const walkthrough = settings?.walkthrough !== false && summary.editedFileStats.length > 0
  const segments = TurnActivity.segments(summary, {
    editedFiles: !walkthrough,
    includeReads: settings?.includeReads !== false,
    lineCounts: settings?.lineCounts !== false,
    testResults: settings?.testResults !== false,
  })
  const failures = summary.failedCommands.length
  const line = segments.length > 0 || failures > 0
  if (!line && !walkthrough) return null
  const canList = failures > 0 && settings?.listFailures !== false
  const openLists = settings?.openLists !== false
  const toggle = (list: OpenList) => () => setOpen(current => (current === list ? undefined : list))
  const start = props.turn.start?.time
  const end = props.turn.end?.time
  const duration = settings?.duration !== false && start !== undefined && end !== undefined ? TurnActivity.duration(end - start) : undefined
  const changesSeq = summary.changesSeq
  const label = (segment: TurnSegment, index: number): string => (index === 0 ? segment.text.charAt(0).toUpperCase() + segment.text.slice(1) : segment.text)
  const segmentView = (segment: TurnSegment, index: number): ReactNode => {
    const list = segment.key === 'files' || segment.key === 'commands' ? segment.key : undefined
    if (list !== undefined && openLists)
      return (
        <Toggle onToggle={toggle(list)} open={open === list}>
          {label(segment, index)}
        </Toggle>
      )
    return <span className={cn('dshx:min-w-0 dshx:truncate', segment.failed === true && 'dshx:text-destructive')}>{label(segment, index)}</span>
  }
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground" data-dshfiles-turn-summary="">
      {line && (
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-1.5 dshx:gap-y-0.5" data-dshfiles-turn-summary-line="">
          <ListChecksIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0" />
          {segments.map((segment, index) => (
            <Fragment key={segment.key}>
              {index > 0 && <span aria-hidden>·</span>}
              {segmentView(segment, index)}
            </Fragment>
          ))}
          {failures > 0 && (
            <button
              aria-expanded={canList ? open === 'failures' : undefined}
              className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-destructive dshx:disabled:cursor-default"
              disabled={!canList}
              onClick={toggle('failures')}
              type="button"
            >
              <span aria-hidden>·</span>
              {failures} failed
              {canList && (open === 'failures' ? <ChevronDownIcon className="dshx:size-3" /> : <ChevronRightIcon className="dshx:size-3" />)}
            </button>
          )}
          {duration !== undefined && (
            <span className="dshx:shrink-0 dshx:tabular-nums" data-dshfiles-turn-summary-duration="">
              <span aria-hidden>· </span>
              {duration}
            </span>
          )}
        </div>
      )}
      {open === 'files' && <FileList openFile={props.openFile} summary={summary} />}
      {open === 'commands' && <CommandList onlyFailed={false} summary={summary} />}
      {open === 'failures' && canList && <CommandList onlyFailed summary={summary} />}
      {walkthrough && (
        <TurnWalkthrough
          openChanges={changesSeq === undefined ? undefined : () => props.openChanges({ seq: changesSeq, turn: props.turn.turn })}
          openFile={props.openFile}
          summary={summary}
          turn={props.turn.turn}
        />
      )}
    </div>
  )
}
