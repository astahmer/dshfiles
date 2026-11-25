import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ChatFocusModel, type ChatTurnTailExtras } from '@dshfiles/chat/chat-focus'
import { DiffStat } from '@dshfiles/plugin-ui/components/diff-stat'
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
        {file.added + file.removed > 0 && <DiffStat added={file.added} removed={file.removed} className="dshx:shrink-0" />}
      </li>
    ))}
  </ul>
)

/**
 * The commands a Turn ran. With `openCall` (a transcript that can open its own rows), each command is a button that
 * unfolds the Turn and opens the call's card, so a command's output stays one click away after the Turn folds.
 */
export const CommandList = (props: {
  readonly summary: TurnActivitySummary
  readonly onlyFailed: boolean
  readonly openCall?: ((callId: string) => void) | undefined
}): JSX.Element => {
  const openCall = props.openCall
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
            {openCall === undefined ? (
              <span className="dshx:min-w-0 dshx:truncate dshx:font-mono">{row.label}</span>
            ) : (
              <button
                aria-label={`Show the output of ${row.label}`}
                className="dshx:min-w-0 dshx:truncate dshx:text-left dshx:font-mono! dshx:hover:text-foreground dshx:hover:underline dshx:pointer-coarse:min-h-11"
                onClick={() => openCall(row.callId)}
                type="button"
              >
                {row.label}
              </button>
            )}
            {failed && <span className="dshx:shrink-0 dshx:text-destructive">{row.outcome}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * One part of the footer. Its separator sits in its left padding, which the row clips at the start of each line, so a
 * wrapped line never begins with "·" and a lone part has none. Every other part draws one, after a chevron too
 * (`TurnActivity.separators`, round six C6).
 */
const Part = (props: { readonly separator: boolean; readonly children: ReactNode }): JSX.Element => (
  <span
    className={cn(
      'dshx:relative dshx:flex dshx:min-w-0 dshx:max-w-full dshx:items-center dshx:pl-3',
      props.separator && "dshx:before:absolute dshx:before:left-1 dshx:before:content-['·']",
    )}
    data-dshfiles-turn-summary-part={props.separator ? 'separated' : 'joined'}
  >
    {props.children}
  </span>
)

/** One part in reading order: what it draws, and whether it ends in a disclosure chevron. */
interface LinePart {
  readonly key: string
  readonly chevron: boolean
  readonly node: ReactNode
}

/**
 * The footer under a finished Turn: "Edited 3 files +42 −7 › · ran 6 commands › · 2 of 42 tests failed › · 1m 12s". The file
 * and command counts open their lists (each file opens in the editor), and the one red part opens the failed commands.
 */
export const TurnSummaryLine = (props: {
  readonly turn: TurnLocation
  readonly openFile: (path: string) => void
  /** Opens this turn's changed-files review at the `workspace/changes` sequence that addresses it. */
  readonly openChanges: (input: { readonly seq: number; readonly turn: number }) => void
  /** The thread's Conversation View opener the Chat fork hands its Turn-tail rows; absent on a detached transcript. */
  readonly openView?: ChatTurnTailExtras['openView']
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
  const openView = props.openView
  const openCall =
    openView === undefined
      ? undefined
      : (callId: string): void => openView(ChatFocusModel.viewId, ChatFocusModel.encode({ turn: props.turn.turn, toolCallId: callId, open: true }))
  const start = props.turn.start?.time
  const end = props.turn.end?.time
  const ownTotal = TurnActivity.saysOwnTotal(props.turn.end?.data.reason.kind)
  const duration = settings?.duration !== false && ownTotal && start !== undefined && end !== undefined ? TurnActivity.shownDuration(end - start) : undefined
  const changesSeq = summary.changesSeq
  const openChanges = changesSeq === undefined ? undefined : () => props.openChanges({ seq: changesSeq, turn: props.turn.turn })
  // With file chips the edits are named once (GitHub #47): `editedFiles: !chips` above already leaves the
  // "Edited N files" part out, and the chips lead the line, so no segment is capitalised as its first word.
  const label = (segment: TurnSegment, index: number): string =>
    index === 0 && !chips ? segment.text.charAt(0).toUpperCase() + segment.text.slice(1) : segment.text
  const segmentPart = (segment: TurnSegment, index: number): LinePart => {
    const list = segment.key === 'files' || segment.key === 'commands' ? segment.key : undefined
    if (list !== undefined && openLists)
      return {
        key: segment.key,
        chevron: true,
        node: (
          <Toggle onToggle={toggle(list)} open={open === list}>
            {label(segment, index)}
          </Toggle>
        ),
      }
    // Failed tests are the turn's one red part: it opens the failed commands instead of a second red count beside it.
    if (segment.opensFailures === true && canList)
      return {
        key: segment.key,
        chevron: true,
        node: (
          <Toggle className="dshx:text-destructive" onToggle={toggle('failures')} open={open === 'failures'}>
            {label(segment, index)}
          </Toggle>
        ),
      }
    // Every test passed: the same green check as an all-pass test card, glyph only; the words keep the line's ink.
    if (segment.passed === true)
      return {
        key: segment.key,
        chevron: false,
        node: (
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1" data-dshfiles-turn-summary-tests="passed">
            <CircleCheckIcon aria-hidden className="dshx:size-3 dshx:shrink-0 dshx:text-success" />
            <span className="dshx:min-w-0 dshx:truncate">{label(segment, index)}</span>
          </span>
        ),
      }
    return {
      key: segment.key,
      chevron: false,
      node: <span className={cn('dshx:min-w-0 dshx:truncate', segment.failed === true && 'dshx:text-destructive')}>{label(segment, index)}</span>,
    }
  }
  const parts: LinePart[] = []
  if (chips)
    parts.push({
      key: 'chips',
      chevron: false,
      node: (
        <TurnFileChips
          files={summary.editedFileStats}
          moreOpen={walkthroughOpen}
          onMore={() => setWalkthroughOpen(current => !current)}
          onOpen={file => (openChanges === undefined ? props.openFile(file.path) : openChanges())}
          opensChanges={openChanges !== undefined}
        />
      ),
    })
  parts.push(...segments.map(segmentPart))
  if (failures > 0)
    parts.push({
      key: 'failures',
      chevron: canList,
      node: (
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
      ),
    })
  if (duration !== undefined)
    parts.push({
      key: 'duration',
      chevron: false,
      node: (
        <span className="dshx:shrink-0 dshx:tabular-nums" data-dshfiles-turn-summary-duration="">
          {duration}
        </span>
      ),
    })
  if (walkthrough)
    parts.push({
      key: 'walkthrough',
      chevron: true,
      node: <TurnWalkthroughToggle open={walkthroughOpen} onToggle={() => setWalkthroughOpen(current => !current)} />,
    })
  const separators = TurnActivity.separators(parts.map(part => part.chevron))
  return (
    <div className="dshx-root dshx:flex dshx:w-fit dshx:max-w-[var(--dsh-chat-prose-measure,100%)] dshx:flex-col dshx:gap-1 dshx:text-sm dshx:text-muted-foreground" data-dshfiles-turn-summary="" data-chat-tail-line="">
      {/* The icon sits on the first line's text baseline (a zero-width space gives it one), so it stays beside "Ran N
          commands" when a 44px touch target sets that line, and wrapped lines keep their indent under the words. */}
      <div className="dshx:flex dshx:min-w-0 dshx:items-baseline dshx:gap-1.5">
        <span aria-hidden className="dshx:inline-flex dshx:shrink-0 dshx:items-center">
          {'\u200b'}
          <ListChecksIcon className="dshx:size-3.5" />
        </span>
        {/* Each part draws its "·" in its own left padding, and the row clips that padding at its left edge: the
            first part of every wrapped line loses its separator instead of starting the line with one. */}
        <div className="dshx:min-w-0 dshx:flex-1 dshx:overflow-x-clip">
          <div className="dshx:-ml-3 dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-y-0.5">
            {parts.map((part, index) => (
              <Part key={part.key} separator={separators[index] === true}>
                {part.node}
              </Part>
            ))}
          </div>
        </div>
      </div>
      {open === 'files' && <FileList openFile={props.openFile} summary={summary} />}
      {open === 'commands' && <CommandList onlyFailed={false} openCall={openCall} summary={summary} />}
      {open === 'failures' && canList && <CommandList onlyFailed openCall={openCall} summary={summary} />}
      {walkthrough && walkthroughOpen && <TurnWalkthroughList openChanges={openChanges} openFile={props.openFile} summary={summary} />}
    </div>
  )
}
