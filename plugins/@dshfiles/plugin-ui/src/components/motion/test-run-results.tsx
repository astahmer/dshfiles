import * as React from 'react'
import { animate, everyFrame, motionSafe, springs } from '../../motion/index.js'
import { useEnter } from '../../motion/react.js'
import { cn } from '../../lib/utils.js'
import { CheckIcon, ChevronDownIcon, CircleCheckIcon, CircleXIcon, LoaderCircleIcon, MinusIcon, XIcon } from '../../icons.js'
import { Button } from '../ui/button.js'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group.js'
import { HeightReveal } from './height-reveal.js'
import { PresenceList } from './presence-list.js'
import { RollingNumber, ShimmerText } from './text.js'

export type TestCaseStatus = 'passed' | 'failed' | 'skipped' | 'running'

export interface TestDiffLine {
  readonly kind: 'expected' | 'received' | 'same'
  readonly text: string
}

export interface TestCase {
  readonly id: string
  readonly name: string
  readonly status: TestCaseStatus
  readonly durationMs?: number
  /** Over the slow threshold. */
  readonly slow?: boolean
  readonly error?: {
    readonly type: string
    readonly message: string
    readonly diff?: readonly TestDiffLine[]
    /** "src/cart/pricing.test.ts:31:29" */
    readonly location?: string
  }
}

export interface TestFile {
  readonly id: string
  readonly path: string
  /** describe() block shown above the cases. */
  readonly suite?: string
  readonly tests: readonly TestCase[]
  readonly durationMs?: number
}

export type TestFilter = 'all' | 'failed' | 'skipped' | 'slow'

const TEST_FILTERS: readonly string[] = ['all', 'failed', 'skipped', 'slow'] satisfies readonly TestFilter[]
const isTestFilter = (value: string): value is TestFilter => TEST_FILTERS.includes(value)

export interface TestRunResultsProps extends React.HTMLAttributes<HTMLElement> {
  readonly status: 'running' | 'passed' | 'failed'
  /** Tests the run will execute (the "of 42"). */
  readonly total: number
  readonly files: readonly TestFile[]
  /** Epoch ms; the elapsed counter ticks while running. */
  readonly startedAt: number
  readonly endedAt?: number
  readonly filter?: TestFilter
  readonly onFilterChange?: (filter: TestFilter) => void
}

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`)

/**
 * A test run streaming into a turn: rolling "n of total" counter, a progress bar that grows green and red as results
 * land, filter tabs with live counts, files that open themselves on failure, and an expected/received diff for each
 * assertion. The agent's test tool output, a verify step, a CI check.
 */
export function TestRunResults({ status, total, files, startedAt, endedAt, filter: controlled, onFilterChange, className, ...props }: TestRunResultsProps) {
  const [own, setOwn] = React.useState<TestFilter>('all')
  const filter = controlled ?? own
  const setFilter = (next: TestFilter) => {
    setOwn(next)
    onFilterChange?.(next)
  }
  const [collapsed, setCollapsed] = React.useState(false)
  const bodyId = React.useId()

  const tests = files.flatMap(file => file.tests)
  const passed = tests.filter(test => test.status === 'passed').length
  const failed = tests.filter(test => test.status === 'failed').length
  const skipped = tests.filter(test => test.status === 'skipped').length
  const slow = tests.filter(test => test.slow === true).length
  const finished = passed + failed + skipped

  const elapsed = React.useRef<HTMLSpanElement>(null)
  React.useEffect(() => {
    const element = elapsed.current
    if (element == null) return
    const write = (now: number) => {
      element.textContent = `${Math.max(0, Math.floor((now - startedAt) / 1000))}s`
    }
    if (status !== 'running' || endedAt !== undefined) {
      write(endedAt ?? Date.now())
      return
    }
    return everyFrame(() => write(Date.now()))
  }, [status, startedAt, endedAt])

  const matches = (test: TestCase) =>
    filter === 'all' ||
    (filter === 'failed' && test.status === 'failed') ||
    (filter === 'skipped' && test.status === 'skipped') ||
    (filter === 'slow' && test.slow === true)
  const visibleFiles = files.map(file => ({ file, tests: file.tests.filter(matches) })).filter(entry => entry.tests.length > 0)

  return (
    <section aria-label="Test run" className={cn('dshx:@container dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm', className)} {...props}>
      <header className="dshx:flex dshx:items-center dshx:gap-2">
        <RunIcon status={status} />
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1.5 dshx:truncate">
          {status === 'running' ? (
            <ShimmerText className="dshx:font-medium">Running tests</ShimmerText>
          ) : (
            <span className={cn('dshx:font-medium', status === 'failed' ? 'dshx:text-destructive' : 'dshx:text-success')}>
              {status === 'failed' ? `${failed} failed` : 'All tests passed'}
            </span>
          )}
          <span className="dshx:flex dshx:text-muted-foreground">
            ·&nbsp;
            <RollingNumber value={finished} />
            &nbsp;of {total}
          </span>
        </span>
        <span ref={elapsed} aria-label="Elapsed" className="dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? 'Show results' : 'Hide results'}
          onClick={() => setCollapsed(value => !value)}
        >
          <ChevronDownIcon className={cn('dshx:transition-transform dshx:motion-reduce:transition-none', !collapsed && 'dshx:rotate-180')} />
        </Button>
      </header>

      <ProgressSegments total={Math.max(total, finished)} passed={passed} failed={failed} skipped={skipped} />

      <HeightReveal open={!collapsed} id={bodyId}>
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:pt-1">
          <ToggleGroup
            type="single"
            size="sm"
            value={filter}
            onValueChange={value => {
              if (isTestFilter(value)) setFilter(value)
            }}
            aria-label="Filter tests"
          >
            <FilterItem value="all" label="All" count={finished} />
            <FilterItem value="failed" label="Failed" count={failed} />
            <FilterItem value="skipped" label="Skipped" count={skipped} />
            <FilterItem value="slow" label="Slow" count={slow} />
          </ToggleGroup>
          <PresenceList
            as="ul"
            aria-label="Test files"
            className="dshx:flex dshx:flex-col dshx:gap-1"
            enter="riseIn"
            items={visibleFiles.map(({ file, tests: shown }) => ({ key: file.id, node: <FileRow file={file} tests={shown} /> }))}
          />
          {visibleFiles.length === 0 ? <p className="dshx:px-1 dshx:py-2 dshx:text-xs dshx:text-muted-foreground">No tests match this filter.</p> : null}
        </div>
      </HeightReveal>
    </section>
  )
}

function RunIcon({ status }: { readonly status: TestRunResultsProps['status'] }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  useEnter(ref, 'popIn', springs.bouncy, status)
  return (
    <span ref={ref} className="dshx:inline-flex dshx:shrink-0">
      {status === 'running' ? (
        <LoaderCircleIcon aria-label="Running" className="dshx:size-4 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none" />
      ) : null}
      {status === 'passed' ? <CircleCheckIcon aria-label="Passed" className="dshx:size-4 dshx:text-success" /> : null}
      {status === 'failed' ? <CircleXIcon aria-label="Failed" className="dshx:size-4 dshx:text-destructive" /> : null}
    </span>
  )
}

function ProgressSegments({
  total,
  passed,
  failed,
  skipped,
}: {
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly skipped: number
}) {
  const refs = [React.useRef<HTMLSpanElement>(null), React.useRef<HTMLSpanElement>(null), React.useRef<HTMLSpanElement>(null)] as const
  const values = [passed, failed, skipped]
  const key = values.join(',')
  React.useEffect(() => {
    const controls = refs.map((ref, index) =>
      ref.current == null ? null : animate(ref.current, { width: `${total === 0 ? 0 : ((values[index] ?? 0) / total) * 100}%` }, motionSafe(springs.smooth)),
    )
    return () => controls.forEach(control => control?.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, total])
  return (
    <div
      role="progressbar"
      aria-label="Tests finished"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={passed + failed + skipped}
      className="dshx:flex dshx:h-1 dshx:w-full dshx:gap-px dshx:overflow-hidden dshx:rounded-full dshx:bg-muted"
    >
      <span ref={refs[0]} className="dshx:h-full dshx:w-0 dshx:rounded-full dshx:bg-success" />
      <span ref={refs[1]} className="dshx:h-full dshx:w-0 dshx:rounded-full dshx:bg-destructive" />
      <span ref={refs[2]} className="dshx:h-full dshx:w-0 dshx:rounded-full dshx:bg-muted-foreground/40" />
    </div>
  )
}

function FilterItem({ value, label, count }: { readonly value: TestFilter; readonly label: string; readonly count: number }) {
  return (
    <ToggleGroupItem
      value={value}
      aria-label={`${label} (${count})`}
      className={cn('dshx:gap-0.5 dshx:px-2', count === 0 && value !== 'all' && 'dshx:text-muted-foreground')}
    >
      {label}
      <RollingNumber value={count} className="dshx:-translate-y-1 dshx:text-[10px] dshx:opacity-70" />
    </ToggleGroupItem>
  )
}

function FileRow({ file, tests }: { readonly file: TestFile; readonly tests: readonly TestCase[] }) {
  const failed = file.tests.filter(test => test.status === 'failed').length
  const running = file.tests.some(test => test.status === 'running')
  const [open, setOpen] = React.useState(failed > 0)
  const opened = React.useRef(failed > 0)
  React.useEffect(() => {
    if (failed > 0 && !opened.current) {
      opened.current = true
      setOpen(true)
    }
  }, [failed])
  const bodyId = React.useId()
  const slash = file.path.lastIndexOf('/')
  return (
    <div className="dshx:flex dshx:flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(value => !value)}
        className="dshx:flex dshx:min-h-8 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:text-left dshx:outline-none dshx:hover:bg-muted/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
      >
        {running ? (
          <LoaderCircleIcon
            aria-label="Running"
            className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none"
          />
        ) : failed > 0 ? (
          <CircleXIcon aria-label="Failed" className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
        ) : (
          <CircleCheckIcon aria-label="Passed" className="dshx:size-3.5 dshx:shrink-0 dshx:text-success" />
        )}
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs">
          <span className="dshx:text-muted-foreground">{file.path.slice(0, slash + 1)}</span>
          {file.path.slice(slash + 1)}
        </span>
        <span className="dshx:shrink-0 dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">
          {failed > 0 ? <span className="dshx:text-foreground">{failed} failed · </span> : null}
          {file.tests.length} tests
          {file.durationMs !== undefined ? ` ${ms(file.durationMs)}` : ''}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform dshx:motion-reduce:transition-none',
            open && 'dshx:rotate-180',
          )}
        />
      </button>
      <HeightReveal open={open} id={bodyId}>
        <div className="dshx:ml-3 dshx:flex dshx:flex-col dshx:border-l dshx:border-border dshx:py-1 dshx:pl-3">
          {file.suite ? <span className="dshx:py-1 dshx:font-medium">{file.suite}</span> : null}
          <PresenceList
            as="ul"
            aria-label={`Tests in ${file.path}`}
            className="dshx:flex dshx:flex-col"
            enter="slideInLeft"
            items={tests.map(test => ({ key: test.id, node: <CaseRow test={test} /> }))}
          />
        </div>
      </HeightReveal>
    </div>
  )
}

function CaseRow({ test }: { readonly test: TestCase }) {
  const failed = test.status === 'failed'
  const [open, setOpen] = React.useState(failed)
  const bodyId = React.useId()
  const icon =
    test.status === 'passed' ? (
      <CheckIcon aria-label="Passed" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
    ) : test.status === 'failed' ? (
      <XIcon aria-label="Failed" className="dshx:size-3.5 dshx:shrink-0 dshx:text-destructive" />
    ) : test.status === 'skipped' ? (
      <MinusIcon aria-label="Skipped" className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground/60" />
    ) : (
      <LoaderCircleIcon
        aria-label="Running"
        className="dshx:size-3.5 dshx:shrink-0 dshx:animate-spin dshx:text-muted-foreground dshx:motion-reduce:animate-none"
      />
    )
  const label = (
    <>
      {icon}
      <span
        className={cn(
          'dshx:min-w-0 dshx:flex-1 dshx:truncate',
          test.status === 'passed' || test.status === 'skipped' ? 'dshx:text-muted-foreground' : 'dshx:text-foreground',
        )}
      >
        {test.status === 'running' ? <ShimmerText>{test.name}</ShimmerText> : test.name}
      </span>
      {test.slow ? <span className="dshx:shrink-0 dshx:rounded dshx:bg-warning/15 dshx:px-1 dshx:text-[10px] dshx:text-warning">slow</span> : null}
      {test.durationMs !== undefined ? (
        <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{ms(test.durationMs)}</span>
      ) : null}
    </>
  )
  if (test.error === undefined) return <div className="dshx:flex dshx:min-h-7 dshx:items-center dshx:gap-2">{label}</div>
  const error = test.error
  return (
    <div className="dshx:flex dshx:flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(value => !value)}
        className="dshx:flex dshx:min-h-7 dshx:items-center dshx:gap-2 dshx:rounded dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
      >
        {label}
        <ChevronDownIcon
          aria-hidden
          className={cn(
            'dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground dshx:transition-transform dshx:motion-reduce:transition-none',
            open && 'dshx:rotate-180',
          )}
        />
      </button>
      <HeightReveal open={open} id={bodyId}>
        <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:py-2 dshx:pl-5.5">
          <div className="dshx:font-mono dshx:text-xs">
            <div className="dshx:text-destructive">{error.type}</div>
            <div className="dshx:text-foreground dshx:break-words">{error.message}</div>
          </div>
          {error.diff ? <DiffBlock lines={error.diff} /> : null}
          {error.location ? <div className="dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{error.location}</div> : null}
        </div>
      </HeightReveal>
    </div>
  )
}

function DiffBlock({ lines }: { readonly lines: readonly TestDiffLine[] }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useEnter(ref, 'slideInLeft', { children: true, stagger: 0.04 })
  return (
    <div className="dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border dshx:font-mono dshx:text-xs">
      <div className="dshx:flex dshx:gap-3 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1.5 dshx:text-muted-foreground">
        <span>
          <span className="dshx:text-success">-</span> Expected
        </span>
        <span>
          <span className="dshx:text-destructive">+</span> Received
        </span>
      </div>
      <div ref={ref} className="dshx:flex dshx:flex-col dshx:py-1">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              'dshx:flex dshx:gap-3 dshx:px-3 dshx:py-0.5 dshx:whitespace-pre',
              line.kind === 'expected' && 'dshx:bg-success/10',
              line.kind === 'received' && 'dshx:bg-destructive/10',
            )}
          >
            <span aria-hidden className={cn('dshx:w-2 dshx:shrink-0', line.kind === 'expected' ? 'dshx:text-success' : 'dshx:text-destructive')}>
              {line.kind === 'expected' ? '-' : line.kind === 'received' ? '+' : ''}
            </span>
            <span className="dshx:sr-only">{line.kind === 'expected' ? 'expected: ' : line.kind === 'received' ? 'received: ' : ''}</span>
            <span className="dshx:min-w-0 dshx:overflow-x-auto">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
