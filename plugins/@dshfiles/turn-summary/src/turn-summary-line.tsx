import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useSettings } from '@dshfiles/dshx/client'
import { ChevronDownIcon, ChevronRightIcon, CircleCheckIcon, CircleXIcon, FileIcon, ListChecksIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { turnSummarySettings } from './settings.js'
import { TURN_ACTIVITY_KEY } from './turn-activity-node.js'
import { TurnActivity, type TurnActivitySummary, type TurnSegment } from './turn-activity.js'
import { MAX_FILE_CHIPS, TurnFileChips } from './turn-file-chips.js'
import { hasEditedFiles, hasWalkthrough, TurnWalkthroughList, TurnWalkthroughToggle } from './turn-walkthrough.js'

type OpenList = 'files' | 'commands' | 'failures'

const Toggle = (props: { readonly open: boolean; readonly onToggle: () => void; readonly className?: string; readonly children: ReactNode }): JSX.Element => (
  <button
    aria-expanded={props.open}
    className={cn('dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:hover:text-foreground dshx:pointer-coarse:min-h-11', props.className)}
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
 * One part of the footer. Its separator sits in its left padding, which the row clips at the start of each line, so a
 * wrapped line never begins with "·" and a lone part has none.
 */
const Part = (props: { readonly children: ReactNode }): JSX.Element => (
  <span className="dshx:relative dshx:flex dshx:min-w-0 dshx:max-w-full dshx:items-center dshx:pl-3 dshx:before:absolute dshx:before:left-1 dshx:before:content-['·']">
    {props.children}
  </span>
)

/**
 * The footer under a finished Turn: "Edited 3 files +42 −7 · ran 6 commands · 2 tests failed · 1m 12s". The file and
 * command counts open their lists (each file opens in the editor), and a failure opens the failed commands.
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
  const [walkthroughOpen, setWalkthroughOpen] = useState(false)
  if (summary === undefined || settings?.enabled === false || TurnActivity.isEmpty(summary)) return null
  // The chips name the edited files; the walkthrough is offered only where it says more than they do.
  const chips = settings?.walkthrough !== false && hasEditedFiles(summary)
  const walkthrough = chips && hasWalkthrough(summary, MAX_FILE_CHIPS)
  const segments = TurnActivity.segments(summary, {
    includeReads: settings?.includeReads !== false,
    lineCounts: settings?.lineCounts !== false,
    testResults: settings?.testResults !== false,
    editedFiles: !chips,
  })
  const failures = TurnActivity.failedCommandsBeyondTests(summary, { testResults: settings?.testResults !== false })
  // A duration alone is no summary: a turn with nothing to name (one plan update, one page render) gets no line.
  if (segments.length === 0 && failures === 0 && !chips) return null
  const canList = summary.failedCommands.length > 0 && settings?.listFailures !== false
  const openLists = settings?.openLists !== false
  const toggle = (list: OpenList) => () => setOpen(current => (current === list ? undefined : list))
  const start = props.turn.start?.time
  const end = props.turn.end?.time
  const duration = settings?.duration !== false && start !== undefined && end !== undefined ? TurnActivity.shownDuration(end - start) : undefined
  const changesSeq = summary.changesSeq
  const openChanges = changesSeq === undefined ? undefined : () => props.openChanges({ seq: changesSeq, turn: props.turn.turn })
  // With file chips the edits are named once (GitHub #47): `editedFiles: !chips` above already leaves the
  // "Edited N files" part out, and the chips lead the line, so no segment is capitalised as its first word.
  const label = (segment: TurnSegment, index: number): string =>
    index === 0 && !chips ? segment.text.charAt(0).toUpperCase() + segment.text.slice(1) : segment.text
  const segmentView = (segment: TurnSegment, index: number): ReactNode => {
    const list = segment.key === 'files' || segment.key === 'commands' ? segment.key : undefined
    if (list !== undefined && openLists)
      return (
        <Toggle onToggle={toggle(list)} open={open === list}>
          {label(segment, index)}
        </Toggle>
      )
    // The one failed command is the test run: its failure opens from the test outcome instead of a second red count.
    if (segment.opensFailures === true && canList)
      return (
        <Toggle className="dshx:text-destructive" onToggle={toggle('failures')} open={open === 'failures'}>
          {label(segment, index)}
        </Toggle>
      )
    return <span className={cn('dshx:min-w-0 dshx:truncate', segment.failed === true && 'dshx:text-destructive')}>{label(segment, index)}</span>
  }
  return (
    <div className="dshx-root dshx:flex dshx:flex-col dshx:gap-1 dshx:text-xs dshx:text-muted-foreground" data-dshfiles-turn-summary="">
      <div className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-1.5">
        <ListChecksIcon aria-hidden className="dshx:mt-0.5 dshx:size-3.5 dshx:shrink-0" />
        {/* Each part draws its "·" in its own left padding, and the row clips that padding at its left edge: the
            first part of every wrapped line loses its separator instead of starting the line with one. */}
        <div className="dshx:min-w-0 dshx:flex-1 dshx:overflow-x-clip">
          <div className="dshx:-ml-3 dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-y-0.5">
            {chips && (
              <Part>
                <TurnFileChips
                  files={summary.editedFileStats}
                  moreOpen={walkthroughOpen}
                  onMore={() => setWalkthroughOpen(current => !current)}
                  onOpen={file => (openChanges === undefined ? props.openFile(file.path) : openChanges())}
                  opensChanges={openChanges !== undefined}
                />
              </Part>
            )}
            {segments.map((segment, index) => (
              <Part key={segment.key}>{segmentView(segment, index)}</Part>
            ))}
            {failures > 0 && (
              <Part>
                <button
                  aria-expanded={canList ? open === 'failures' : undefined}
                  className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:text-destructive dshx:disabled:cursor-default dshx:pointer-coarse:min-h-11"
                  disabled={!canList}
                  onClick={toggle('failures')}
                  type="button"
                >
                  {failures} {failures === 1 ? 'command' : 'commands'} failed
                  {canList && (open === 'failures' ? <ChevronDownIcon className="dshx:size-3" /> : <ChevronRightIcon className="dshx:size-3" />)}
                </button>
              </Part>
            )}
            {duration !== undefined && (
              <Part>
                <span className="dshx:shrink-0 dshx:tabular-nums" data-dshfiles-turn-summary-duration="">
                  {duration}
                </span>
              </Part>
            )}
            {walkthrough ? (
              <Part>
                <TurnWalkthroughToggle open={walkthroughOpen} onToggle={() => setWalkthroughOpen(current => !current)} />
              </Part>
            ) : null}
          </div>
        </div>
      </div>
      {open === 'files' && <FileList openFile={props.openFile} summary={summary} />}
      {open === 'commands' && <CommandList onlyFailed={false} summary={summary} />}
      {open === 'failures' && canList && <CommandList onlyFailed summary={summary} />}
      {walkthrough && walkthroughOpen && <TurnWalkthroughList openChanges={openChanges} openFile={props.openFile} summary={summary} />}
    </div>
  )
}
