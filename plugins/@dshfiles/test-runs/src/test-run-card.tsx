import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { FilePath, StackTrace } from '@dshfiles/plugin-ui/components/stack-trace'
import { StatusIcon, ToolCard } from '@dshfiles/plugin-ui/components/tool-card'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ChevronDownIcon, ChevronUpIcon, CircleCheckIcon, CopyIcon, RotateCwIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import { VitestReport, type TestCase, type TestFailure, type TestFile, type TestRun } from './vitest-report.js'

type Filter = 'all' | 'failed' | 'skipped' | 'slow'

export interface TestRunActions {
  readonly askToFix: (text: string) => boolean
}

type OpenFile = (path: string, options?: { readonly line?: number }) => void

const isFailing = (test: TestCase): boolean => test.status === 'failed' || test.status === 'timeout'

const formatDuration = (milliseconds: number | undefined): string => {
  if (milliseconds === undefined) return ''
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  return `${(milliseconds / 1000).toFixed(1)}s`
}

const matchesFilter = (test: TestCase, filter: Filter): boolean => {
  if (filter === 'failed') return isFailing(test)
  if (filter === 'skipped') return test.status === 'skipped'
  if (filter === 'slow') return VitestReport.isSlow(test)
  return true
}

const FailureDetail = (props: {
  readonly failure: TestFailure
  readonly file: string
  readonly test: TestCase
  readonly actions: TestRunActions | undefined
  readonly openFile: OpenFile
}) => {
  const failure = props.failure
  const timedOut = props.test.status === 'timeout'
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:py-2 dshx:pl-6">
      {timedOut ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-1">
          <span className="dshx:text-sm dshx:font-medium">{failure.message.replace(/\.$/, '')}</span>
          {failure.hint !== undefined && <span className="dshx:text-xs dshx:text-muted-foreground">{failure.hint}</span>}
        </div>
      ) : (
        <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:font-mono dshx:text-xs">
          <span className="dshx:text-muted-foreground">{failure.errorName}</span>
          <span className="dshx:break-words dshx:whitespace-pre-wrap">{failure.message}</span>
          {failure.hint !== undefined && <span className="dshx:whitespace-pre-wrap dshx:text-muted-foreground">{failure.hint}</span>}
        </div>
      )}
      {failure.diff.length > 0 && (
        <div className="dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:font-mono dshx:text-xs">
          <div className="dshx:flex dshx:gap-3 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1.5 dshx:text-muted-foreground">
            <span>
              <span className="dshx:text-success">-</span> Expected
            </span>
            <span>
              <span className="dshx:text-destructive">+</span> Received
            </span>
          </div>
          <div className="dshx:overflow-x-auto dshx:py-1">
            {failure.diff.map((line, index) => (
              <div
                className={cn(
                  'dshx:flex dshx:gap-3 dshx:px-3 dshx:whitespace-pre',
                  line.kind === 'expected' && 'dshx:bg-success/10',
                  line.kind === 'received' && 'dshx:bg-destructive/10',
                )}
                key={index}
              >
                <span
                  className={cn('dshx:w-2 dshx:shrink-0', line.kind === 'expected' && 'dshx:text-success', line.kind === 'received' && 'dshx:text-destructive')}
                >
                  {line.kind === 'expected' ? '-' : line.kind === 'received' ? '+' : ''}
                </span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <StackTrace codeFrame={failure.codeFrame} frames={failure.frames} location={failure.location} openFile={props.openFile} />
      <div className="dshx:flex dshx:items-center dshx:gap-1">
        {props.actions !== undefined && (
          <>
            <Button onClick={() => props.actions?.askToFix(VitestReport.fixPrompt(props))} size="xs" type="button" variant="outline">
              <SparklesIcon /> Ask to fix
            </Button>
            <Button onClick={() => props.actions?.askToFix(VitestReport.rerunPrompt(props))} size="xs" type="button" variant="ghost">
              <RotateCwIcon /> Rerun
            </Button>
          </>
        )}
        <Button aria-label="Copy failure" onClick={() => void writeClipboard(failure.raw)} size="icon" type="button" variant="ghost" className="dshx:size-6">
          <CopyIcon />
        </Button>
      </div>
    </div>
  )
}

const TestRow = (props: {
  readonly test: TestCase
  readonly file: string
  readonly suitePrefix: string | undefined
  readonly actions: TestRunActions | undefined
  readonly openFile: OpenFile
  readonly openFailures: boolean
}) => {
  const failing = isFailing(props.test)
  const [open, setOpen] = useState(failing && props.openFailures)
  const expandable = props.test.failure !== undefined
  return (
    <li className="dshx:flex dshx:flex-col">
      <button
        aria-expanded={expandable ? open : undefined}
        className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-1 dshx:text-left dshx:text-sm"
        disabled={!expandable}
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <StatusIcon status={props.test.status} />
        <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate', !failing && 'dshx:text-muted-foreground')}>
          {props.suitePrefix !== undefined && props.suitePrefix !== '' && <span className="dshx:text-muted-foreground">{props.suitePrefix} › </span>}
          {props.test.title}
        </span>
        {props.test.status === 'timeout' && <span className="dshx:text-xs dshx:text-destructive">timed out</span>}
        <span className="dshx:text-xs dshx:text-muted-foreground">{formatDuration(props.test.durationMs)}</span>
        {expandable && (open ? <ChevronUpIcon className="dshx:size-3.5" /> : <ChevronDownIcon className="dshx:size-3.5" />)}
      </button>
      {open && props.test.failure !== undefined && (
        <FailureDetail actions={props.actions} failure={props.test.failure} file={props.file} openFile={props.openFile} test={props.test} />
      )}
    </li>
  )
}

const FileRow = (props: {
  readonly file: TestFile
  readonly filter: Filter
  readonly actions: TestRunActions | undefined
  readonly openFile: OpenFile
  readonly openFailures: boolean
}) => {
  const [open, setOpen] = useState(props.file.status === 'failed' && props.openFailures)
  const tests = props.file.tests.filter(test => matchesFilter(test, props.filter))
  const suitesNamed = tests.every(test => test.suitesKnown)
  const groups = new Map<string, TestCase[]>()
  for (const test of tests) {
    const suite = suitesNamed ? test.suites.join(' > ') : ''
    groups.set(suite, [...(groups.get(suite) ?? []), test])
  }
  const meta = [
    props.file.failedCount > 0 ? `${props.file.failedCount} failed` : undefined,
    props.file.testCount === undefined ? undefined : `${props.file.testCount} ${props.file.testCount === 1 ? 'test' : 'tests'}`,
    props.file.skippedCount > 0 ? `${props.file.skippedCount} skipped` : undefined,
  ].filter(part => part !== undefined)
  return (
    <li className="dshx:flex dshx:flex-col">
      <button
        aria-expanded={open}
        className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:py-1.5 dshx:text-left"
        onClick={() => setOpen(value => !value)}
        type="button"
      >
        <StatusIcon status={props.file.status} variant="group" />
        <FilePath path={props.file.path} />
        <span className="dshx:ml-auto dshx:shrink-0 dshx:text-xs dshx:text-foreground dshx:@max-pane-narrow:hidden">{meta.join(' · ')}</span>
        <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground">{formatDuration(props.file.durationMs)}</span>
        {open ? <ChevronUpIcon className="dshx:size-3.5 dshx:shrink-0" /> : <ChevronDownIcon className="dshx:size-3.5 dshx:shrink-0" />}
      </button>
      {open && (
        <div className="dshx:ml-2 dshx:flex dshx:flex-col dshx:gap-1 dshx:border-l dshx:border-border dshx:pl-4">
          {props.file.error !== undefined && (
            <FailureDetail
              actions={props.actions}
              failure={props.file.error}
              file={props.file.path}
              openFile={props.openFile}
              test={{ suites: [], suitesKnown: true, title: props.file.path, status: 'failed', durationMs: undefined, failure: props.file.error }}
            />
          )}
          {[...groups].map(([suite, suiteTests]) => (
            <div className="dshx:flex dshx:flex-col" key={suite}>
              {suite !== '' && <span className="dshx:py-1 dshx:text-sm dshx:font-medium">{suite}</span>}
              <ul className={cn('dshx:flex dshx:flex-col', suite !== '' && 'dshx:border-l dshx:border-border dshx:pl-4')}>
                {suiteTests.map(test => (
                  <TestRow
                    actions={props.actions}
                    file={props.file.path}
                    key={`${test.suites.join('>')}>${test.title}`}
                    openFailures={props.openFailures}
                    openFile={props.openFile}
                    suitePrefix={suitesNamed ? undefined : test.suites.join(' › ')}
                    test={test}
                  />
                ))}
              </ul>
            </div>
          ))}
          {props.file.tests.length === 0 && props.file.error === undefined && (
            <span className="dshx:py-1 dshx:text-xs dshx:text-muted-foreground">
              The reporter listed no test of this file; run with --reporter=verbose to see them.
            </span>
          )}
        </div>
      )}
    </li>
  )
}

/** Settled Vitest run: progress bar, filters, per-file results and failure detail. */
export const TestRunCard = (props: {
  readonly run: TestRun
  readonly actions: TestRunActions | undefined
  readonly openFile: OpenFile
  readonly openFailures: boolean
}) => {
  const tally = props.run.testTally
  const failing = tally.failed > 0 || props.run.fileTally.failed > 0
  const [open, setOpen] = useState(failing && props.openFailures)
  const [filter, setFilter] = useState<Filter>('all')
  const allTests = props.run.files.flatMap(file => file.tests)
  const counts = {
    all: tally.total,
    failed: tally.failed,
    skipped: tally.skipped,
    slow: allTests.filter(test => VitestReport.isSlow(test)).length,
  } satisfies Record<Filter, number>
  const files = props.run.files.filter(
    file => filter === 'all' || (filter === 'failed' && file.error !== undefined) || file.tests.some(test => matchesFilter(test, filter)),
  )
  const percent = (value: number): string => `${tally.total === 0 ? 0 : (value / tally.total) * 100}%`
  const headline = VitestReport.summaryLabel(props.run)
  return (
    <ToolCard
      className="dshx:@container"
      meta={formatDuration(props.run.durationMs)}
      onToggle={() => setOpen(value => !value)}
      open={open}
      status={failing ? 'failed' : 'passed'}
      summary={headline}
      title="Ran tests"
    >
      <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-1" data-test-runs-card="">
        <div aria-hidden className="dshx:flex dshx:h-1 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
          <span className="dshx:bg-success" style={{ width: percent(tally.passed) }} />
          <span className="dshx:bg-destructive" style={{ width: percent(tally.failed) }} />
          <span className="dshx:bg-muted-foreground/30" style={{ width: percent(tally.skipped) }} />
        </div>
        <div className="dshx:flex dshx:flex-wrap dshx:gap-1" role="tablist">
          {(['all', 'failed', 'skipped', 'slow'] as const).map(candidate => (
            <button
              aria-selected={filter === candidate}
              className={cn(
                'dshx:rounded-md dshx:px-2 dshx:py-0.5 dshx:text-sm dshx:capitalize',
                filter === candidate ? 'dshx:bg-muted dshx:font-medium' : 'dshx:text-muted-foreground',
                counts[candidate] === 0 && candidate !== 'all' && 'dshx:opacity-50',
              )}
              key={candidate}
              onClick={() => setFilter(candidate)}
              role="tab"
              type="button"
            >
              {candidate} <span className="dshx:tabular-nums">{counts[candidate]}</span>
            </button>
          ))}
        </div>
        <ul className="dshx:flex dshx:flex-col">
          {files.map(file => (
            <FileRow actions={props.actions} file={file} filter={filter} key={file.path} openFailures={props.openFailures} openFile={props.openFile} />
          ))}
        </ul>
        {props.run.unlistedFiles > 0 && filter === 'all' && (
          <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
            <CircleCheckIcon className="dshx:size-4 dshx:text-success" />
            {props.run.unlistedFiles} more {props.run.unlistedFiles === 1 ? 'file' : 'files'} passed
          </span>
        )}
      </div>
    </ToolCard>
  )
}

/** While the shell call runs the Host streams no output, so the count of finished tests is unknown. */
export const TestRunPending = (props: { readonly command: string }) => (
  <span data-test-runs-card="running">
    <ToolCard
      expandable={false}
      onToggle={() => undefined}
      open={false}
      status="running"
      summary={<span className="dshx:font-mono dshx:text-xs">{props.command}</span>}
      title="Running tests"
    />
  </span>
)
