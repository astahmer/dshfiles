import * as React from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  BookmarkIcon,
  BookOpenIcon,
  BotIcon,
  CircleXIcon,
  ClockIcon,
  CodeIcon,
  DatabaseIcon,
  DiffIcon,
  DollarSignIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  GlobeIcon,
  HammerIcon,
  KeyRoundIcon,
  KeyIcon,
  LayersIcon,
  ListTodoIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  NetworkIcon,
  RefreshCwIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UploadIcon,
  WrenchIcon,
  CircleDollarSignIcon,
} from '@dshfiles/plugin-ui/icons'
import { PipelineRun, type PipelineLogLine, type PipelineRunStatus, type PipelineStep } from '@dshfiles/plugin-ui/components/motion/pipeline-run'
import { ActivityDock, DockChanges, DockChecklist, type DockChecklistItem } from '@dshfiles/plugin-ui/components/motion/activity-dock'
import { ActivityFeed, type ActivityFeedEvent } from '@dshfiles/plugin-ui/components/motion/activity-feed'
import { CreditsUsage, type CreditCategory } from '@dshfiles/plugin-ui/components/motion/credits-usage'
import { SpendMap, type SpendDimension } from '@dshfiles/plugin-ui/components/motion/spend-map'
import { AccessMap, type AccessLevel, type AccessRule } from '@dshfiles/plugin-ui/components/motion/access-map'
import { SessionRecap, type RecapMoment, type RecapStep } from '@dshfiles/plugin-ui/components/motion/session-recap'
import { ShimmerText } from '@dshfiles/plugin-ui/components/motion/text'
import type { GalleryDemo } from './types.js'

/** Run `effect` after `ms`, cleared on change/unmount. */
function useTimeout(effect: () => void, ms: number | null, deps: React.DependencyList) {
  const latest = React.useRef(effect)
  latest.current = effect
  React.useEffect(() => {
    if (ms === null) return
    const id = window.setTimeout(() => latest.current(), ms)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps])
}

/** Call `tick` every `ms` while `active`. */
function useInterval(tick: () => void, ms: number, active = true) {
  const latest = React.useRef(tick)
  latest.current = tick
  React.useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => latest.current(), ms)
    return () => window.clearInterval(id)
  }, [ms, active])
}

// ─── PipelineRun ────────────────────────────────────────────────────────────

const landingScript: readonly {
  readonly id: string
  readonly label: string
  readonly title: string
  readonly lines: readonly { readonly text: string; readonly icon: React.ReactNode }[]
}[] = [
  {
    id: 'rebase',
    label: 'Rebase',
    title: 'Rebase onto main',
    lines: [
      { text: 'Fetching main@origin', icon: <RefreshCwIcon /> },
      { text: 'Rebasing 3 revisions', icon: <GitBranchIcon /> },
    ],
  },
  {
    id: 'typecheck',
    label: 'Typecheck',
    title: 'Typecheck 42 packages',
    lines: [
      { text: 'tsc -b plugins/@dshfiles/*', icon: <CodeIcon /> },
      { text: 'No errors in 1,912 files', icon: <CodeIcon /> },
    ],
  },
  {
    id: 'test',
    label: 'Test',
    title: 'Run related tests',
    lines: [
      { text: 'Collecting 1,284 tests', icon: <FlaskConicalIcon /> },
      { text: '1,284 passed, 0 failed', icon: <FlaskConicalIcon /> },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    title: 'Build changed plugins',
    lines: [
      { text: 'dshx build plugin-ui', icon: <HammerIcon /> },
      { text: 'Bundling client.js (412 kB)', icon: <HammerIcon /> },
    ],
  },
  {
    id: 'land',
    label: 'Land',
    title: 'Move main',
    lines: [
      { text: 'Advancing bookmark main', icon: <BookmarkIcon /> },
      { text: 'Syncing the default workspace', icon: <UploadIcon /> },
    ],
  },
]

function PipelineRunDemo() {
  const [status, setStatus] = React.useState<PipelineRunStatus>('idle')
  const [stepIndex, setStepIndex] = React.useState(0)
  const [lineCount, setLineCount] = React.useState(0)
  const [startedAt, setStartedAt] = React.useState(() => Date.now())
  const [durations, setDurations] = React.useState<number[]>([])
  const [target, setTarget] = React.useState('main')
  const [failNext, setFailNext] = React.useState(false)
  const script = landingScript[stepIndex]

  const start = () => {
    setStatus('running')
    setStepIndex(0)
    setLineCount(1)
    setDurations([])
    setStartedAt(Date.now())
  }
  const reset = () => {
    setStatus('idle')
    setStepIndex(0)
    setLineCount(0)
    setDurations([])
    setFailNext(false)
  }

  // Script the run: lines arrive, then the step settles and the next one starts.
  useTimeout(
    () => {
      if (status === 'idle') return start()
      if (status !== 'running' || script === undefined) return reset()
      if (lineCount < script.lines.length) return setLineCount(count => count + 1)
      const seconds = (Date.now() - startedAt) / 1000
      setDurations(list => [...list, seconds])
      if (failNext) {
        setStatus('failed')
        return
      }
      if (stepIndex === landingScript.length - 1) {
        setStatus('done')
        return
      }
      setStepIndex(index => index + 1)
      setLineCount(1)
      setStartedAt(Date.now())
    },
    status === 'idle' ? 1200 : status === 'running' ? 750 : 5200,
    [status, stepIndex, lineCount],
  )

  const steps: PipelineStep[] = landingScript.map((entry, index) => {
    const duration = durations[index]
    const state =
      status === 'idle'
        ? 'pending'
        : index < stepIndex
          ? 'done'
          : index > stepIndex
            ? 'pending'
            : status === 'running'
              ? 'running'
              : status === 'failed'
                ? 'failed'
                : 'done'
    return duration === undefined ? { id: entry.id, label: entry.label, state } : { id: entry.id, label: entry.label, state, durationSeconds: duration }
  })
  const lines: PipelineLogLine[] = (script?.lines ?? []).slice(0, lineCount).map((line, index, all) => ({
    id: `${script?.id}-${index}`,
    text: line.text,
    icon: line.icon,
    state: index === all.length - 1 ? 'running' : 'done',
  }))
  const total = durations.reduce((sum, value) => sum + value, 0)

  return (
    <TooltipProvider>
      <PipelineRun
        className="dshx:mx-auto dshx:max-w-[480px]"
        heading="Land thread-025a80"
        subtitle="3 revisions → main"
        icon={<GitMergeIcon />}
        status={status}
        steps={steps}
        doneLabel="Landed"
        activity={script ? { title: script.title, startedAt, lines } : undefined}
        summary={
          status === 'failed'
            ? {
                title: `${script?.label ?? 'Step'} failed`,
                rows: [
                  { id: 'step', label: 'Stopped at', value: script?.label ?? '', icon: <CircleXIcon /> },
                  { id: 'time', label: 'After', value: `${total.toFixed(1)}s`, icon: <ClockIcon /> },
                  { id: 'kept', label: 'Revisions', value: 'kept in the workspace', icon: <GitCommitHorizontalIcon /> },
                ],
              }
            : {
                title: `Landed on ${target}`,
                rows: [
                  { id: 'time', label: 'Duration', value: `${total.toFixed(1)}s`, icon: <ClockIcon /> },
                  { id: 'tests', label: 'Tests', value: '1,284 passed', icon: <FlaskConicalIcon /> },
                  { id: 'bundle', label: 'Bundle', value: '412 kB', icon: <LayersIcon /> },
                  { id: 'rev', label: 'Bookmark', value: `${target} → 94526da8`, icon: <BookmarkIcon /> },
                ],
              }
        }
        targets={[
          { value: 'main', label: 'main' },
          { value: 'release', label: 'release' },
        ]}
        target={target}
        onTargetChange={setTarget}
        extraAction={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                aria-label="Fail the current step"
                aria-pressed={failNext}
                disabled={status !== 'running'}
                onClick={() => setFailNext(true)}
                className="dshx:size-9 dshx:rounded-full dshx:aria-pressed:text-destructive"
              >
                <TriangleAlertIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fail the current step</TooltipContent>
          </Tooltip>
        }
        onStart={start}
        onCancel={reset}
        onReset={reset}
      />
    </TooltipProvider>
  )
}

// ─── ActivityDock ───────────────────────────────────────────────────────────

const planLabels = ['Read the checkout totals flow', 'Round line items before tax', 'Cover the edge cases with tests', 'Land the revision']
const tour: readonly (string | null)[] = [null, 'plan', 'plan', 'changes', 'agents', 'plan', null]

function ActivityDockDemo() {
  const [value, setValue] = React.useState<string | null>(null)
  const [touring, setTouring] = React.useState(true)
  const [stop, setStop] = React.useState(0)
  const [progress, setProgress] = React.useState(1)

  useInterval(() => setStop(index => (index + 1) % tour.length), 2600, touring)
  React.useEffect(() => {
    if (touring) setValue(tour[stop] ?? null)
  }, [stop, touring])
  useInterval(() => setProgress(step => (step + 1) % (planLabels.length + 1)), 1900)

  const items: DockChecklistItem[] = planLabels.map((label, index) => ({
    id: String(index),
    label,
    state: index < progress ? 'done' : index === progress ? 'active' : 'pending',
  }))
  const remaining = planLabels.length - progress

  return (
    <div className="dshx:relative dshx:h-[380px] dshx:overflow-hidden dshx:rounded-xl dshx:border dshx:border-border dshx:bg-background">
      <div aria-hidden className="dshx:flex dshx:flex-col dshx:gap-5 dshx:p-6 dshx:pt-16">
        {[0.9, 0.7, 0.8, 0.55].map((width, index) => (
          <div key={index} className="dshx:flex dshx:gap-3">
            <span className="dshx:size-5 dshx:shrink-0 dshx:rounded-full dshx:bg-muted" />
            <div className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-2">
              <span className="dshx:h-2.5 dshx:w-24 dshx:rounded-full dshx:bg-muted" />
              <span className="dshx:h-2 dshx:rounded-full dshx:bg-muted/70" style={{ width: `${width * 100}%` }} />
              <span className="dshx:h-2 dshx:rounded-full dshx:bg-muted/70" style={{ width: `${width * 70}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="dshx:absolute dshx:top-3 dshx:right-3 dshx:left-3 dshx:flex dshx:justify-end">
        <ActivityDock
          aria-label="Thread activity"
          value={value}
          onValueChange={next => {
            setTouring(false)
            setValue(next)
          }}
          tabs={[
            {
              id: 'plan',
              label: 'Plan',
              icon: <ListTodoIcon />,
              badge: remaining,
              meta: `${Math.min(progress, planLabels.length)} of ${planLabels.length}`,
              content: <DockChecklist items={items} />,
            },
            {
              id: 'changes',
              label: 'Changes',
              title: 'Changes by destination',
              icon: <DiffIcon />,
              meta: (
                <>
                  3 files <span className="dshx:text-success">+91</span> <span className="dshx:text-destructive">−9</span>
                </>
              ),
              content: (
                <DockChanges
                  groups={[
                    {
                      id: 'repo',
                      label: 'Workspace',
                      icon: <FolderGit2Icon />,
                      hint: 'Lands on main through a rebase.',
                      name: 'dshfiles',
                      branch: 'thread-025a80',
                      files: [
                        { path: 'tax.ts', added: 9, removed: 3 },
                        { path: 'totals.test.ts', added: 64, removed: 0 },
                      ],
                      more: 1,
                    },
                  ]}
                />
              ),
              footer: (
                <button
                  type="button"
                  className="dshx:flex dshx:w-full dshx:items-center dshx:justify-between dshx:text-xs dshx:text-muted-foreground dshx:hover:text-foreground"
                >
                  See all changes <ExternalLinkIcon className="dshx:size-3.5" />
                </button>
              ),
            },
            {
              id: 'agents',
              label: 'Subagents',
              icon: <BotIcon />,
              badge: 1,
              meta: '2 running',
              content: (
                <ul className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
                  <li className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
                    <ShimmerText className="dshx:min-w-0 dshx:truncate">Explorer · reading tax rules</ShimmerText>
                    <span className="dshx:text-xs dshx:text-muted-foreground">0:42</span>
                  </li>
                  <li className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2">
                    <ShimmerText className="dshx:min-w-0 dshx:truncate">Reviewer · checking rounding</ShimmerText>
                    <span className="dshx:text-xs dshx:text-muted-foreground">0:18</span>
                  </li>
                  <li className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:text-muted-foreground">
                    <span className="dshx:min-w-0 dshx:truncate">Tester · finished</span>
                    <span className="dshx:text-xs">1:05</span>
                  </li>
                </ul>
              ),
            },
            {
              id: 'workspace',
              label: 'Workspace',
              icon: <GitBranchIcon />,
              meta: 'jj',
              content: (
                <dl className="dshx:grid dshx:grid-cols-[auto_1fr] dshx:gap-x-3 dshx:gap-y-1.5 dshx:text-sm">
                  <dt className="dshx:text-muted-foreground">Revision</dt>
                  <dd className="dshx:font-mono dshx:text-xs dshx:leading-5">94526da8</dd>
                  <dt className="dshx:text-muted-foreground">Above main</dt>
                  <dd>3 revisions</dd>
                  <dt className="dshx:text-muted-foreground">Conflicts</dt>
                  <dd className="dshx:text-success">None</dd>
                </dl>
              ),
            },
          ]}
        />
      </div>
    </div>
  )
}

// ─── ActivityFeed ───────────────────────────────────────────────────────────

type FeedKind = 'status' | 'comment' | 'revision'
type FeedFilter = 'all' | FeedKind

const actors = {
  you: { name: 'You', initials: 'YO', tone: 'info' },
  luna: { name: 'Luna', initials: 'LU', tone: 'violet' },
  explorer: { name: 'Explorer', initials: 'EX', tone: 'teal' },
  reviewer: { name: 'Reviewer', initials: 'RV', tone: 'warning' },
  tester: { name: 'Tester', initials: 'TE', tone: 'success' },
} as const satisfies Record<string, ActivityFeedEvent['actor']>

const seedFeed: readonly (ActivityFeedEvent & { readonly kind: FeedKind })[] = [
  { id: 'f1', kind: 'status', actor: actors.luna, verb: 'completed', target: 'Fix flaky typecheck', scope: 'dshfiles', time: '2h ago', group: 'This week' },
  {
    id: 'f2',
    kind: 'revision',
    actor: actors.you,
    verb: 'landed',
    target: 'feat(gallery): usage tab',
    preposition: 'on',
    destination: 'main',
    time: '5h ago',
    group: 'This week',
  },
  {
    id: 'f3',
    kind: 'comment',
    actor: actors.reviewer,
    verb: 'commented on',
    target: 'Round line items before tax',
    scope: 'checkout',
    time: '1d ago',
    group: 'This week',
  },
  {
    id: 'f4',
    kind: 'status',
    actor: actors.explorer,
    verb: 'moved',
    target: 'Trace slow thread switch',
    preposition: 'to',
    destination: 'Doing',
    scope: 'dshfiles',
    time: '2d ago',
    group: 'This week',
  },
  { id: 'f5', kind: 'revision', actor: actors.tester, verb: 'added tests to', target: 'totals.test.ts', scope: 'checkout', time: '3d ago', group: 'This week' },
  { id: 'f6', kind: 'status', actor: actors.you, verb: 'created', target: 'Spend caps per agent', scope: 'backlog', time: 'Oct 28', group: 'Earlier' },
  { id: 'f7', kind: 'comment', actor: actors.luna, verb: 'replied on', target: 'Memory digest is stale', scope: 'memory', time: 'Oct 26', group: 'Earlier' },
  { id: 'f8', kind: 'status', actor: actors.reviewer, verb: 'completed', target: 'Color tokens v2', scope: 'plugin-ui', time: 'Oct 24', group: 'Earlier' },
]

const incoming: readonly Omit<ActivityFeedEvent & { readonly kind: FeedKind }, 'id' | 'time' | 'group'>[] = [
  { kind: 'status', actor: actors.luna, verb: 'started', target: 'Cap subagent spend', scope: 'backlog' },
  { kind: 'comment', actor: actors.reviewer, verb: 'asked about', target: 'Projected overage', scope: 'usage' },
  { kind: 'revision', actor: actors.tester, verb: 'described', target: 'test(usage): cover caps', scope: 'dshfiles' },
  { kind: 'status', actor: actors.explorer, verb: 'completed', target: 'Profile the Host lag', scope: 'dshfiles' },
]

function ActivityFeedDemo() {
  const [events, setEvents] = React.useState(seedFeed)
  const [filter, setFilter] = React.useState<FeedFilter>('all')
  const counter = React.useRef(0)
  useInterval(() => {
    const next = incoming[counter.current % incoming.length]
    counter.current += 1
    if (next === undefined) return
    setEvents(list =>
      [
        { ...next, id: `n${counter.current}`, time: 'just now', group: 'Today' },
        ...list.map(event => (event.group === 'Today' ? { ...event, time: 'a minute ago' } : event)),
      ].slice(0, 11),
    )
  }, 3600)
  const visible = filter === 'all' ? events : events.filter(event => event.kind === filter)
  return (
    <ActivityFeed
      events={visible}
      filters={[
        { value: 'all', label: 'All' },
        { value: 'status', label: 'Status changes' },
        { value: 'comment', label: 'Comments' },
        { value: 'revision', label: 'Revisions' },
      ]}
      filter={filter}
      onFilterChange={setFilter}
      quietGroups={['Earlier']}
      onSelectEvent={() => undefined}
    />
  )
}

// ─── CreditsUsage ───────────────────────────────────────────────────────────

const week = ['T', 'F', 'S', 'S', 'M', 'T', 'W']
const creditOptions = [
  { id: '500', label: '500 credits', hint: 'About 6 days', price: '$10' },
  { id: '1000', label: '1,000 credits', hint: 'About 12 days, past the reset', price: '$20' },
  { id: '2500', label: '2,500 credits', hint: 'About a month', price: '$45' },
] as const

function CreditsUsageDemo() {
  const [categories, setCategories] = React.useState<CreditCategory[]>([
    {
      id: 'replies',
      label: 'Thread replies',
      icon: <MessageSquareIcon />,
      tone: 'violet',
      total: 270,
      caption: '41 per day on average',
      chart: 'stems',
      series: [41, 41, 38, 41, 34, 42, 33],
      axisLabels: week,
    },
    {
      id: 'review',
      label: 'Code review',
      icon: <CodeIcon />,
      tone: 'info',
      total: 216,
      caption: '82 more than last month',
      chart: 'area',
      series: [8, 36, 70, 110, 140, 190, 216],
      axisLabels: week,
    },
    {
      id: 'research',
      label: 'Research',
      icon: <BookOpenIcon />,
      tone: 'warning',
      total: 102,
      caption: '11 memory digests',
      chart: 'bars',
      series: [8, 12, 18, 14, 19, 17, 14],
      axisLabels: week,
    },
  ])
  const [selected, setSelected] = React.useState<string>('1000')
  const [touched, setTouched] = React.useState(false)

  useInterval(() => {
    setCategories(list =>
      list.map((category, index) => {
        const bump = [3, 5, 2][index] ?? 1
        const series = [...category.series]
        const last = series.length - 1
        series[last] = (series[last] ?? 0) + (category.chart === 'area' ? bump : Math.round(bump / 2))
        return { ...category, total: category.total + bump, series }
      }),
    )
  }, 2400)
  useInterval(() => setSelected(id => (id === '500' ? '1000' : id === '1000' ? '2500' : '500')), 3000, !touched)

  const option = creditOptions.find(entry => entry.id === selected)
  return (
    <CreditsUsage
      categories={categories}
      summary={
        <>
          This week your agents used <strong>84 credits a day</strong>. At that pace the monthly credits run out on <strong>Nov 24</strong>, before they reset
          on <strong>Dec 1</strong>.
        </>
      }
      budgetLabel="Used in November"
      limit={2000}
      options={creditOptions}
      selectedOptionId={selected}
      onSelectOption={id => {
        setTouched(true)
        setSelected(id)
      }}
      confirmLabel={option ? `Add ${option.label.replace(' credits', '')} · ${option.price}` : 'Add credits'}
      onConfirm={() => setTouched(true)}
      onCancel={() => setTouched(true)}
    />
  )
}

// ─── SpendMap ───────────────────────────────────────────────────────────────

const wave = (seed: number, base: number) =>
  Array.from({ length: 18 }, (_, index) => base * (0.7 + 0.3 * Math.sin(index / 2.2 + seed) + 0.15 * Math.sin(index * 1.7 + seed * 3)))

const spendDimensions: readonly SpendDimension[] = [
  {
    id: 'models',
    label: 'Models',
    icon: <SparklesIcon />,
    leaves: [
      { id: 'ds-chat', label: 'deepseek-chat', amount: 382, share: 0.41, trend: 14, series: wave(1, 20), projected: 637 },
      { id: 'gpt', label: 'gpt-5.1', amount: 231, share: 0.25, trend: 6, series: wave(2, 13) },
      { id: 'reasoner', label: 'deepseek-reasoner', amount: 166, share: 0.18, trend: 22, series: wave(3, 9) },
      { id: 'mini', label: 'gpt-5.1-mini', amount: 89, share: 0.1, trend: -8, series: wave(4, 5) },
      { id: 'qwen', label: 'qwen3-coder', amount: 63, share: 0.06, trend: -3, series: wave(5, 3) },
    ],
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: <FolderIcon />,
    leaves: [
      {
        id: 'dshfiles',
        label: 'dshfiles',
        icon: <FolderGit2Icon />,
        amount: 354,
        share: 0.38,
        flag: { label: 'Near cap', tone: 'warning' },
        series: wave(6, 19),
        cap: 400,
        projected: 380,
      },
      {
        id: 'checkout',
        label: 'checkout',
        icon: <FolderGit2Icon />,
        amount: 268,
        share: 0.29,
        flag: { label: 'Over cap', tone: 'destructive' },
        series: wave(7, 15),
        cap: 400,
        projected: 447,
      },
      {
        id: 'site',
        label: 'booshi.gg',
        icon: <FolderGit2Icon />,
        amount: 194,
        share: 0.21,
        flag: { label: 'Near cap', tone: 'warning' },
        series: wave(8, 11),
        cap: 250,
        projected: 232,
      },
      { id: 'notes', label: 'notes', icon: <FolderGit2Icon />, amount: 115, share: 0.12, trend: -5, series: wave(9, 6) },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    icon: <BotIcon />,
    leaves: [
      { id: 'luna', label: 'Luna', amount: 251, share: 0.27, trend: 11, series: wave(10, 14) },
      { id: 'reviewer', label: 'Reviewer', icon: <CodeIcon />, amount: 181, share: 0.19, trend: 31, series: wave(11, 10) },
      { id: 'explorer', label: 'Explorer', icon: <NetworkIcon />, amount: 134, share: 0.14, trend: -6, series: wave(12, 7) },
      { id: 'tester', label: 'Tester', icon: <FlaskConicalIcon />, amount: 109, share: 0.12, trend: 2, series: wave(13, 6) },
      { id: 'scribe', label: 'Memory digests', icon: <BookOpenIcon />, amount: 97, share: 0.1, trend: 15, series: wave(14, 5) },
    ],
  },
  {
    id: 'keys',
    label: 'API keys',
    icon: <KeyRoundIcon />,
    leaves: [
      { id: 'prod', label: 'secret:DEEPSEEK', icon: <KeyIcon />, amount: 661, share: 0.71, trend: 9, series: wave(15, 36) },
      { id: 'jev', label: 'secret:JEV', icon: <KeyIcon />, amount: 270, share: 0.29, trend: -2, series: wave(16, 15) },
    ],
  },
]

function SpendMapDemo() {
  const [dimensionId, setDimensionId] = React.useState('models')
  const [leafId, setLeafId] = React.useState<string | null>('ds-chat')
  const [metric, setMetric] = React.useState('cost')
  const [total, setTotal] = React.useState(931)
  const [touched, setTouched] = React.useState(false)
  const tourStep = React.useRef(0)

  useInterval(() => setTotal(value => (value >= 1180 ? 931 : value + 7)), 2200)
  useInterval(
    () => {
      tourStep.current += 1
      const dimension = spendDimensions.find(entry => entry.id === dimensionId)
      const leaves = dimension?.leaves ?? []
      const index = leaves.findIndex(entry => entry.id === leafId)
      if (index >= 0 && index < Math.min(2, leaves.length - 1)) {
        setLeafId(leaves[index + 1]?.id ?? null)
        return
      }
      const nextIndex = (spendDimensions.findIndex(entry => entry.id === dimensionId) + 1) % spendDimensions.length
      const next = spendDimensions[nextIndex]
      if (next === undefined) return
      setDimensionId(next.id)
      setLeafId(next.leaves[0]?.id ?? null)
    },
    2600,
    !touched,
  )

  const format =
    metric === 'tokens'
      ? (value: number) => `${((value * 68_400) / 1_000_000).toFixed(1)}M`
      : (value: number) => `$${Math.round(value).toLocaleString('en-US')}`
  return (
    <SpendMap
      heading="Spend map"
      subtitle="Nov 1 to 18, split four ways"
      owner="This machine"
      period="Day 18 / 30"
      total={total}
      cap={1500}
      projected={Math.round((total / 18) * 30)}
      dimensions={spendDimensions}
      dimensionId={dimensionId}
      onDimensionChange={id => {
        setTouched(true)
        setDimensionId(id)
        setLeafId(spendDimensions.find(entry => entry.id === id)?.leaves[0]?.id ?? null)
      }}
      leafId={leafId}
      onLeafChange={id => {
        setTouched(true)
        setLeafId(id)
      }}
      metrics={[
        { value: 'cost', label: 'Cost', icon: <CircleDollarSignIcon /> },
        { value: 'tokens', label: 'Tokens', icon: <LayersIcon /> },
      ]}
      metric={metric}
      onMetricChange={setMetric}
      format={format}
      footer={
        <>
          <span>{spendDimensions.find(entry => entry.id === dimensionId)?.leaves.length} entries · top 2 hold 66% of spend</span>
          <span>Updated just now</span>
        </>
      }
    />
  )
}

// ─── AccessMap ──────────────────────────────────────────────────────────────

const accessLevels: readonly AccessLevel[] = [
  { id: 'owner', label: 'Only you', sourceIds: ['you'] },
  { id: 'agents', label: 'Agents', sourceIds: ['you', 'agents'] },
  { id: 'anyone', label: 'Anyone', sourceIds: ['you', 'agents', 'lan'], open: true },
]

function AccessMapDemo() {
  const [rules, setRules] = React.useState<AccessRule[]>([
    { id: 'list', verb: 'list aliases', levelId: 'agents', reachesTarget: false },
    { id: 'write', verb: 'write, delete', levelId: 'owner', reachesTarget: false },
    { id: 'read', verb: 'read value', levelId: 'anyone' },
  ])
  const [touched, setTouched] = React.useState(false)
  // Close and reopen the leak on a loop until someone picks a level by hand.
  useInterval(
    () => setRules(list => list.map(rule => (rule.id === 'read' ? { ...rule, levelId: rule.levelId === 'anyone' ? 'agents' : 'anyone' } : rule))),
    4200,
    !touched,
  )
  return (
    <AccessMap
      heading="Who can reach your secrets"
      subtitle="Access map for the MCP endpoint, scanned today at 09:42"
      sources={[
        { id: 'you', label: 'You', detail: 'Web GUI', initials: 'YO' },
        { id: 'agents', label: 'Agents', detail: '3 threads, 2 subagents', icon: <BotIcon /> },
        { id: 'lan', label: 'LAN clients', detail: 'No token needed', icon: <GlobeIcon /> },
      ]}
      gateway={{ label: 'secret_get', detail: 'MCP endpoint', icon: <WrenchIcon /> }}
      rules={rules}
      levels={accessLevels}
      onRuleChange={(ruleId, levelId) => {
        setTouched(true)
        setRules(list => list.map(rule => (rule.id === ruleId ? { ...rule, levelId } : rule)))
      }}
      target={{
        label: 'Secret catalog',
        detail: '38 aliases',
        icon: <DatabaseIcon />,
        fields: [
          { name: 'alias', type: 'text' },
          { name: 'value', type: 'secret' },
          { name: 'scope', type: 'enum' },
          { name: 'env', type: 'text' },
        ],
      }}
      edgeLabels={{ agents: '128 reads', lan: '4 reads' }}
      evidence={[
        {
          sourceId: 'lan',
          title: '4 reads this week',
          items: [
            { id: 'r1', tag: 'NAS', label: 'Today 03:12' },
            { id: 'r2', tag: 'TV', label: 'Tue 22:47' },
            { id: 'r3', tag: 'TV', label: 'Tue 22:46' },
          ],
        },
      ]}
    />
  )
}

// ─── SessionRecap ───────────────────────────────────────────────────────────

const recapMoments: readonly RecapMoment[] = [
  {
    id: 'm1',
    at: 312,
    kind: 'cost',
    participantId: 'luna',
    role: 'Thread agent',
    quote: 'Switching to the reasoner for the tax rules; this step will cost about four times more per turn.',
    clipSeconds: 6,
  },
  {
    id: 'm2',
    at: 725,
    kind: 'failure',
    participantId: 'tester',
    role: 'Subagent',
    quote: 'totals.test.ts fails on 0.005 rounding: the line items are rounded after tax, not before.',
    clipSeconds: 7,
  },
  {
    id: 'm3',
    at: 1102,
    kind: 'question',
    participantId: 'reviewer',
    role: 'Review subagent',
    quote: 'We already round in the invoice service, so you have to beat it on consistency per currency.',
    clipSeconds: 7,
  },
  {
    id: 'm4',
    at: 1460,
    kind: 'cost',
    participantId: 'explorer',
    role: 'Subagent',
    quote: 'Scanning 1,900 files for other rounding sites; this is the most expensive search of the run.',
    clipSeconds: 5,
  },
  {
    id: 'm5',
    at: 1830,
    kind: 'decision',
    participantId: 'you',
    role: 'Owner',
    quote: 'Round per line before tax, keep the invoice service as is, and land behind the new test.',
    clipSeconds: 6,
  },
]

function SessionRecapDemo() {
  const [momentId, setMomentId] = React.useState<string>('m3')
  const [playing, setPlaying] = React.useState(true)
  const [progress, setProgress] = React.useState(0)
  const [touched, setTouched] = React.useState(false)
  const [steps, setSteps] = React.useState<RecapStep[]>([
    { id: 's1', label: 'Round line items before tax in totals.ts', owner: 'Luna', ownerInitials: 'LU', due: 'Today', done: false },
    { id: 's2', label: 'Add the 0.005 regression to totals.test.ts', owner: 'Tester', ownerInitials: 'TE', due: 'Today', done: false },
    { id: 's3', label: 'Land behind a review of the invoice service', owner: 'You', ownerInitials: 'YO', due: 'Nov 6', done: false },
  ])
  const moment = recapMoments.find(entry => entry.id === momentId)
  const clip = moment?.clipSeconds ?? 7

  // The excerpt plays through; untouched, the tour then moves on to the next moment.
  useInterval(
    () => {
      const next = progress + 0.1 / clip
      if (next < 1) {
        setProgress(next)
        return
      }
      if (!touched) {
        const index = recapMoments.findIndex(entry => entry.id === momentId)
        const following = recapMoments[(index + 1) % recapMoments.length]
        if (following) setMomentId(following.id)
        setProgress(0)
        return
      }
      setProgress(1)
      setPlaying(false)
    },
    100,
    playing,
  )
  // Tick a next step off now and then while nobody is clicking.
  useInterval(
    () =>
      setSteps(list =>
        list.every(step => step.done)
          ? list.map(step => ({ ...step, done: false }))
          : list.map((step, index) => (index === list.findIndex(entry => !entry.done) ? { ...step, done: true } : step)),
      ),
    4500,
    !touched,
  )

  return (
    <SessionRecap
      heading="Fix checkout totals rounding"
      meta={['deepseek-chat', 'Nov 4, 2026', '34 min']}
      icon={<GitMergeIcon />}
      status={{ label: 'Needs review', tone: 'destructive' }}
      participants={[
        { id: 'luna', name: 'Luna', initials: 'LU', tone: 'info', share: 0.38 },
        { id: 'explorer', name: 'Explorer', initials: 'EX', tone: 'info-soft', share: 0.14 },
        { id: 'tester', name: 'Tester', initials: 'TE', tone: 'violet', share: 0.31 },
        { id: 'reviewer', name: 'Reviewer', initials: 'RV', tone: 'violet-soft', share: 0.12 },
        { id: 'you', name: 'You', initials: 'YO', tone: 'teal', share: 0.05 },
      ]}
      shareLabel="Thread agent 52% · Subagents 48%"
      durationSeconds={2052}
      kinds={[
        { id: 'cost', label: 'Cost spike', icon: <DollarSignIcon /> },
        { id: 'failure', label: 'Failure', icon: <CircleXIcon /> },
        { id: 'question', label: 'Objection', icon: <MessageCircleQuestionIcon /> },
        { id: 'decision', label: 'Decision', icon: <GitBranchIcon /> },
      ]}
      moments={recapMoments}
      momentId={momentId}
      onMomentChange={id => {
        setTouched(true)
        setMomentId(id)
        setProgress(0)
        setPlaying(true)
      }}
      playing={playing}
      progress={progress}
      onPlayToggle={() => {
        setTouched(true)
        if (progress >= 1) setProgress(0)
        setPlaying(value => !value)
      }}
      summary="Line items were rounded after tax, so totals drifted by a cent on mixed carts. The fix rounds per line before tax and leaves the invoice service alone; the reviewer wants the per-currency behaviour pinned by a test before it lands. Cost spiked twice, both on the reasoner and the repository-wide search."
      summaryBy="deepseek-chat"
      onCopySummary={() => undefined}
      steps={steps}
      onToggleStep={(id, done) => {
        setTouched(true)
        setSteps(list => list.map(step => (step.id === id ? { ...step, done } : step)))
      }}
    />
  )
}

export const usageDemos: readonly GalleryDemo[] = [
  {
    id: 'usage-credits',
    title: 'CreditsUsage',
    description:
      'Credits per agent category with self-drawing mini charts and a top-up picker: where a month of thread and subagent usage went, and what to add.',
    source: "import { CreditsUsage } from '@dshfiles/plugin-ui/components/motion/credits-usage'",
    wide: true,
    render: () => <CreditsUsageDemo />,
  },
  {
    id: 'usage-spend-map',
    title: 'SpendMap',
    description: 'A cap gauge fanning out to models, projects, agents and keys, with a drawn route to the selected entry and its cost detail.',
    source: "import { SpendMap } from '@dshfiles/plugin-ui/components/motion/spend-map'",
    wide: true,
    render: () => <SpendMapDemo />,
  },
  {
    id: 'usage-activity-feed',
    title: 'ActivityFeed',
    description: 'A grouped who-did-what feed over backlog items, threads and jj revisions; filters glide and rows FLIP as new events drop in.',
    source: "import { ActivityFeed } from '@dshfiles/plugin-ui/components/motion/activity-feed'",
    render: () => <ActivityFeedDemo />,
  },
  {
    id: 'usage-activity-dock',
    title: 'ActivityDock',
    description: "A thread's corner dock: plan, changes, subagents and workspace as icons that spring open into a panel.",
    source: "import { ActivityDock, DockChecklist, DockChanges } from '@dshfiles/plugin-ui/components/motion/activity-dock'",
    render: () => <ActivityDockDemo />,
  },
  {
    id: 'usage-session-recap',
    title: 'SessionRecap',
    description: 'A finished thread at a glance: turn share, flagged key moments with a replayable excerpt, the summary and next steps.',
    source: "import { SessionRecap } from '@dshfiles/plugin-ui/components/motion/session-recap'",
    wide: true,
    render: () => <SessionRecapDemo />,
  },
  {
    id: 'usage-access-map',
    title: 'AccessMap',
    description: 'Which agents and clients can reach a tool or secret; an open path turns red with traffic running along it until you tighten the level.',
    source: "import { AccessMap } from '@dshfiles/plugin-ui/components/motion/access-map'",
    wide: true,
    render: () => <AccessMapDemo />,
  },
  {
    id: 'usage-pipeline-run',
    title: 'PipelineRun',
    description: 'Landing a thread workspace step by step (rebase, typecheck, test, build, move main) with a live log and a settled summary.',
    source: "import { PipelineRun } from '@dshfiles/plugin-ui/components/motion/pipeline-run'",
    render: () => <PipelineRunDemo />,
  },
]
