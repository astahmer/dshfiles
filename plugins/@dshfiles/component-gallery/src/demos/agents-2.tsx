import * as React from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { AgentRoster, type RosterAgent } from '@dshfiles/plugin-ui/components/motion/agent-roster'
import { CheckpointGraph, type Checkpoint } from '@dshfiles/plugin-ui/components/motion/checkpoint-graph'
import { ContextGraph, type GraphNode } from '@dshfiles/plugin-ui/components/motion/context-graph'
import { DelegatorBoard, type DelegatorItem, type DelegatorSection } from '@dshfiles/plugin-ui/components/motion/delegator-board'
import { ShapeshiftCard, type ShapeshiftPhase, type ShapeshiftView } from '@dshfiles/plugin-ui/components/motion/shapeshift-card'
import { StepTrail, type TrailStep } from '@dshfiles/plugin-ui/components/motion/step-trail'
import { RollingNumber, Typewriter } from '@dshfiles/plugin-ui/components/motion/text'
import { WorkflowRun, type FlowStep, type RunEntry } from '@dshfiles/plugin-ui/components/motion/workflow-run'
import {
  BookMarkedIcon,
  BugIcon,
  CoinsIcon,
  CreditCardIcon,
  CpuIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderGit2Icon,
  FolderIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HashIcon,
  ListTodoIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  SquarePenIcon,
  TableIcon,
} from '@dshfiles/plugin-ui/icons'
import type { GalleryDemo } from './types.js'

/** A counter that advances every `ms`; demos derive their whole simulated state from it. */
function useTick(ms: number, paused = false): number {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (paused) return
    const id = window.setInterval(() => setTick(value => value + 1), ms)
    return () => window.clearInterval(id)
  }, [ms, paused])
  return tick
}

// ── DelegatorBoard ────────────────────────────────────────────────────────────

function DelegatorBoardDemo() {
  const tick = useTick(700) % 22
  const progress = Math.min(1, 0.3 + tick * 0.07)
  const buildDone = progress >= 1
  const soakDone = tick >= 16
  const needsYou: DelegatorItem[] =
    tick >= 6 && tick < 12
      ? [{ id: 'approve', title: 'Approve the notarization retry', detail: 'The build agent wants to re-run signing on macos-26.', status: 'needs-you' }]
      : []
  const release: DelegatorItem[] = [
    {
      id: 'build',
      title: '0.0.3 build',
      detail: buildDone ? 'Built, signed and notarized. Uploaded to releases.' : 'Retry on macos-26 after the macos-15 crash. Building, signing, notarizing.',
      status: buildDone ? 'done' : 'running',
      progress,
    },
    ...(soakDone ? [{ id: 'soak', title: 'Overnight soak script', detail: '7-hour soak passed. Report attached.', status: 'done' as const }] : []),
    { id: 'iso', title: 'ISO drops on the M4 (#41)', detail: 'Merged. Encoders start in order, 25 ms apart.', status: 'done' },
    { id: 'prompts', title: 'Camera and mic prompts (#50)', detail: 'Merged. The app can ask for the camera.', status: 'done' },
  ]
  const agents: DelegatorItem[] = [
    ...(soakDone
      ? []
      : [
          {
            id: 'soak',
            title: 'Overnight soak script',
            detail: '7-hour soak, streaming to the log host. Tested on a spare Mac first.',
            status: 'running' as const,
          },
        ]),
    {
      id: 'plugins',
      title: 'Plugin events and file access (#53)',
      detail: 'Fix round: symlink redirects, exFAT rename. Merges after 0.0.3.',
      status: 'running',
    },
    { id: 'harness', title: 'Motion test harness', detail: 'Waiting for the build agent to free the runner.', status: buildDone ? 'running' : 'waiting' },
  ]
  const sections: DelegatorSection[] = [
    { id: 'needs', label: 'Needs you', items: needsYou, empty: "Nothing. You're free." },
    { id: 'release', label: 'Release', items: release },
    { id: 'agents', label: 'Agents', items: agents },
  ]
  return (
    <DelegatorBoard
      headline={soakDone ? 'Overnight done: 0.0.3 published, soak passed.' : 'Overnight: publish 0.0.3, update the Mac, run the 7-hour soak.'}
      summary={needsYou.length > 0 ? 'One decision is waiting for you.' : 'Nothing needed until morning. The soak report will be here.'}
      sections={sections}
      onSelect={() => undefined}
    />
  )
}

// ── StepTrail ─────────────────────────────────────────────────────────────────

const trailScript = ['Pulled 24 sources', 'Wrote cost overview', 'Writing the provider section'] as const

function trailStage(tick: number): number {
  if (tick < 2) return 0
  if (tick < 4) return 1
  if (tick < 9) return 2
  if (tick < 11) return 3
  return 4
}

function StepTrailDemo() {
  const tick = useTick(900) % 14
  const status = (index: number): TrailStep['status'] => {
    const stage = trailStage(tick)
    if (index < stage) return 'done'
    if (index === stage) return index === 4 ? 'gated' : 'active'
    return index === 4 ? 'gated' : 'pending'
  }
  const subCount = Math.max(0, Math.min(3, tick - 4))
  const steps: TrailStep[] = [
    { id: 'collect', label: 'Collect usage data', status: status(0), meta: '12s', activeLabel: 'Reading' },
    { id: 'compare', label: 'Compare providers', status: status(1), meta: '18s', activeLabel: 'Comparing' },
    {
      id: 'draft',
      label: 'Draft the report',
      status: status(2),
      meta: '41s',
      activeLabel: 'Writing',
      substeps: trailScript
        .slice(0, Math.max(1, subCount))
        .map((label, index, all) => ({ id: label, label, status: index === all.length - 1 ? 'active' : 'done' })),
    },
    { id: 'check', label: 'Check every number', status: status(3), meta: '9s', activeLabel: 'Checking' },
    { id: 'send', label: 'Post to the team thread', status: status(4), gateLabel: 'Asks first' },
  ]
  return <StepTrail steps={steps} className="dshx:mx-auto dshx:max-w-sm" />
}

// ── AgentRoster ───────────────────────────────────────────────────────────────

const rosterSeed: readonly RosterAgent[] = [
  { id: 'refactor', title: 'Refactor fee module', activity: 'Editing 4 files', status: 'running', eta: '~1 min' },
  { id: 'audit', title: 'Audit token flows', activity: 'Reading contracts', status: 'running', eta: '~4 min' },
  { id: 'summarize', title: 'Summarize PRs', activity: 'Ready to review', status: 'done' },
]

function AgentRosterDemo() {
  const [agents, setAgents] = React.useState<readonly RosterAgent[]>(rosterSeed)
  const tick = useTick(1400)
  React.useEffect(() => {
    const step = tick % 9
    setAgents(list => {
      if (step === 0) return rosterSeed
      return list.map(agent => {
        if (agent.id === 'refactor' && agent.status === 'running') {
          if (step === 2) return { ...agent, activity: 'Editing 6 files' }
          if (step === 3) return { ...agent, activity: 'Running tests', eta: '~20 s' }
          if (step === 4) return { ...agent, activity: 'Ready to review', status: 'done' }
        }
        if (agent.id === 'audit' && agent.status === 'running') {
          if (step === 3) return { ...agent, activity: 'Tracing 3 call sites', eta: '~2 min' }
          if (step === 6) return { ...agent, activity: 'Ready to review', status: 'done' }
        }
        return agent
      })
    })
    if (step === 5)
      setAgents(list =>
        list.some(agent => agent.id === 'docs')
          ? list
          : [{ id: 'docs', title: 'Update the README', activity: 'Planning', status: 'running', eta: '~3 min' }, ...list],
      )
  }, [tick])
  return (
    <AgentRoster
      className="dshx:mx-auto dshx:max-w-sm"
      agents={agents}
      onReview={agent => setAgents(list => list.filter(item => item.id !== agent.id))}
      onStopAll={() => setAgents(list => list.filter(agent => agent.status !== 'running'))}
    />
  )
}

// ── CheckpointGraph ───────────────────────────────────────────────────────────

type CheckpointEvent = (list: readonly Checkpoint[]) => readonly Checkpoint[]

const add =
  (checkpoint: Checkpoint): CheckpointEvent =>
  list => [...list, checkpoint]
const abandon =
  (...ids: string[]): CheckpointEvent =>
  list =>
    list.map(item => (ids.includes(item.id) ? { ...item, abandoned: true } : item))
const both =
  (...events: CheckpointEvent[]): CheckpointEvent =>
  list =>
    events.reduce((acc, event) => event(acc), list)

const checkpointScript: readonly CheckpointEvent[] = [
  add({ id: 'c1', label: 'Read the brief', icon: <FileTextIcon />, lane: 0, time: '0:09' }),
  add({ id: 'c2', label: 'Scaffolded the pricing page', icon: <FolderGit2Icon />, lane: 0, files: 4, time: '0:30' }),
  add({ id: 'c3', label: 'Wrote the plan copy', icon: <PencilIcon />, lane: 0, files: 1, time: '0:47' }),
  add({ id: 'c4', label: 'Built the pricing table', icon: <TableIcon />, lane: 0, files: 3, time: '1:21' }),
  add({ id: 'c5', label: 'Added card checkout', icon: <CreditCardIcon />, lane: 0, files: 5, time: '2:02', note: 'Stopped' }),
  both(abandon('c4', 'c5'), add({ id: 'c6', label: 'Switched to embedded checkout', icon: <CreditCardIcon />, lane: 1, attempt: 2, files: 3, time: '2:40' })),
  add({ id: 'c7', label: 'Tests pass – 12 of 12', icon: <FlaskConicalIcon />, lane: 1, time: '3:04' }),
  add({ id: 'c8', label: 'Opened the pull request', icon: <GitPullRequestIcon />, lane: 1, files: 1, time: '3:15' }),
  both(abandon('c8'), add({ id: 'c9', label: 'Switched to embedded checkout', icon: <CreditCardIcon />, lane: 0, attempt: 3, files: 3, time: '3:53' })),
  add({ id: 'c10', label: 'Tests pass – 12 of 12', icon: <FlaskConicalIcon />, lane: 0, time: '4:17' }),
  add({ id: 'c11', label: 'Opened the pull request', icon: <GitPullRequestIcon />, lane: 0, files: 1, time: '4:28' }),
]

function CheckpointGraphDemo() {
  const [{ step, cycle }, setRun] = React.useState({ step: 2, cycle: 0 })
  const [selected, setSelected] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    const id = window.setTimeout(
      () => setRun(run => (run.step >= checkpointScript.length + 3 ? { step: 2, cycle: run.cycle + 1 } : { step: run.step + 1, cycle: run.cycle })),
      step >= checkpointScript.length ? 1800 : 1250,
    )
    return () => window.clearTimeout(id)
  }, [step])
  const checkpoints = checkpointScript.slice(0, Math.min(step, checkpointScript.length)).reduce<readonly Checkpoint[]>((list, event) => event(list), [])
  const attempts = checkpoints.some(item => item.attempt === 3) ? 3 : checkpoints.some(item => item.attempt === 2) ? 2 : 1
  return (
    <CheckpointGraph
      key={cycle}
      goal="Ship the pricing page"
      checkpoints={checkpoints}
      attempts={attempts}
      cost={0.04 * checkpoints.length + 0.02 * (attempts - 1)}
      selectedId={selected}
      onRestore={checkpoint => setSelected(checkpoint.id)}
    />
  )
}

// ── ContextGraph ──────────────────────────────────────────────────────────────

const repos = [
  { id: 'dshfiles', name: 'neolectron/dshfiles', commit: 'a1f3c2e · Tighten the outline', folders: ['plugins/component-gallery', 'plugins/plugin-ui'] },
  { id: 'blog', name: 'neolectron/blog', commit: '9b02d4f · Draft the motion post', folders: ['content/posts'] },
  { id: 'dither', name: 'neolectron/dither-mini', commit: '5e77a10 · Faster error diffusion', folders: ['src/kernels', 'bench'] },
] as const

function ContextGraphDemo() {
  const [repoId, setRepoId] = React.useState<string>('dshfiles')
  const [manual, setManual] = React.useState(false)
  const [extraFolders, setExtraFolders] = React.useState(0)
  const tick = useTick(2600, manual)
  React.useEffect(() => {
    if (manual || tick === 0) return
    setRepoId(repos[tick % repos.length]?.id ?? 'dshfiles')
  }, [tick, manual])
  const repo = repos.find(item => item.id === repoId) ?? repos[0]
  const folders = [...repo.folders, ...Array.from({ length: extraFolders }, (_, index) => `docs/notes-${index + 1}`)]
  const columns: GraphNode[][] = [
    [
      {
        id: 'repos',
        label: 'Projects',
        icon: <BookMarkedIcon />,
        items: repos.map(item => ({ id: item.id, label: item.name.split('/')[1] ?? item.name, icon: <BookMarkedIcon />, selected: item.id === repoId })),
        className: 'dshx:w-36',
      },
    ],
    [
      {
        id: 'repository',
        label: 'Repository',
        icon: <GitBranchIcon />,
        items: [
          {
            id: `repo-${repo.id}`,
            label: (
              <span className="dshx:flex dshx:flex-col">
                <span className="dshx:truncate">{repo.name}</span>
                <span className="dshx:truncate dshx:text-[10px] dshx:text-muted-foreground">{repo.commit}</span>
              </span>
            ),
          },
        ],
        footer: (
          <div className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:px-1.5 dshx:py-1 dshx:text-xs dshx:text-foreground">
            <GitBranchIcon aria-hidden className="dshx:size-3.5 dshx:text-success" />
            main
          </div>
        ),
      },
      {
        id: 'folders',
        label: 'Folders',
        icon: <FolderIcon />,
        count: folders.length,
        items: folders.map((folder, index) => ({ id: folder, label: folder, icon: <FolderIcon />, meta: 14 - index * 3 })),
        footer: (
          <button
            type="button"
            onClick={() => setExtraFolders(value => (value >= 2 ? 0 : value + 1))}
            className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:rounded-md dshx:px-1.5 dshx:py-1 dshx:text-xs dshx:text-muted-foreground dshx:hover:bg-accent dshx:hover:text-foreground"
          >
            <PlusIcon aria-hidden className="dshx:size-3.5" />
            Add folder
          </button>
        ),
      },
    ],
    [
      {
        id: 'composer',
        label: 'Composer',
        className: 'dshx:w-60 dshx:@max-pane-narrow:w-52',
        body: (
          <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:p-1">
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs">
              <span className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:rounded-md dshx:bg-muted dshx:px-1.5 dshx:py-0.5 dshx:text-foreground">
                <CpuIcon aria-hidden className="dshx:size-3" />
                Deep model
              </span>
              <span className="dshx:flex-1" />
              <span className="dshx:text-muted-foreground">Medium</span>
              <span className="dshx:h-1.5 dshx:w-10 dshx:overflow-hidden dshx:rounded-full dshx:bg-muted">
                <span className="dshx:block dshx:h-full dshx:w-1/2 dshx:bg-foreground/60" />
              </span>
            </div>
            <div className="dshx:min-h-12 dshx:rounded-lg dshx:bg-muted/50 dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-muted-foreground">
              <Typewriter key={repo.id} text={`Ask about ${repo.name.split('/')[1] ?? repo.name}, or type / for skills and tools.`} speed={0.025} />
            </div>
            <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:text-muted-foreground">
              <MicIcon aria-hidden className="dshx:size-3.5" />
              <span className="dshx:inline-flex dshx:items-center dshx:gap-1">
                <SearchIcon aria-hidden className="dshx:size-3.5" />
                Research
              </span>
              <span className="dshx:flex-1" />
              <span className="dshx:inline-flex dshx:items-center dshx:gap-1 dshx:tabular-nums">
                <FolderIcon aria-hidden className="dshx:size-3.5" />
                <RollingNumber value={folders.length} />
              </span>
            </div>
          </div>
        ),
      },
    ],
  ]
  return (
    <ContextGraph
      columns={columns}
      edges={[
        { from: 'repos', to: 'repository' },
        { from: 'repository', to: 'composer' },
        { from: 'folders', to: 'composer' },
      ]}
      onSelect={(nodeId, itemId) => {
        if (nodeId !== 'repos') return
        setManual(true)
        setRepoId(itemId)
      }}
    />
  )
}

// ── ShapeshiftCard ────────────────────────────────────────────────────────────

interface ShapeScene {
  readonly prompt: string
  readonly view: ShapeshiftView
  readonly done: { readonly title: string; readonly detail: string }
}

function StartThreadForm({ onStart }: { readonly onStart: () => void }) {
  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-2 dshx:text-sm">
      {[
        ['Project', 'dshfiles'],
        ['Agent', '@luna · fixer'],
        ['Workspace', 'New jj workspace from main'],
      ].map(([key, value]) => (
        <div key={key} className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-3 dshx:border-b dshx:border-border dshx:pb-2">
          <span className="dshx:text-muted-foreground">{key}</span>
          <span className="dshx:min-w-0 dshx:truncate dshx:text-foreground">{value}</span>
        </div>
      ))}
      <Button size="sm" className="dshx:self-end" onClick={onStart}>
        Start thread
      </Button>
    </div>
  )
}

function ShapeshiftDemo() {
  const [scene, setScene] = React.useState(0)
  const [typed, setTyped] = React.useState(0)
  const [phase, setPhase] = React.useState<ShapeshiftPhase>('idle')
  const advance = React.useCallback(() => setPhase('done'), [])
  const scenes: readonly ShapeScene[] = React.useMemo(
    () => [
      {
        prompt: 'what did today cost?',
        view: {
          key: 'cost',
          icon: <CoinsIcon />,
          title: 'Spend today',
          body: (
            <div className="dshx:flex dshx:flex-col dshx:gap-3">
              <div className="dshx:flex dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:py-2">
                <RollingNumber
                  value={phase === 'view' ? 14.82 : 0}
                  format={value => `$${value.toFixed(2)}`}
                  className="dshx:text-4xl dshx:font-semibold dshx:tracking-tight dshx:text-foreground"
                />
                <span className="dshx:text-xs dshx:text-muted-foreground">Across 23 threads · 4.1M tokens</span>
              </div>
              {[
                ['Agents', '$11.40'],
                ['Subagents', '$2.96'],
                ['Memory and titles', '$0.46'],
              ].map(([key, value]) => (
                <div key={key} className="dshx:flex dshx:justify-between dshx:border-t dshx:border-border dshx:pt-2 dshx:text-sm">
                  <span className="dshx:text-muted-foreground">{key}</span>
                  <span className="dshx:tabular-nums dshx:text-foreground">{value}</span>
                </div>
              ))}
            </div>
          ),
        },
        done: { title: 'Report saved', detail: 'Today’s spend is pinned to the Usage tab.' },
      },
      {
        prompt: 'start a thread on the auth bug',
        view: { key: 'thread', icon: <SquarePenIcon />, title: 'New thread', body: <StartThreadForm onStart={advance} /> },
        done: { title: 'Thread started', detail: '@luna is reproducing the auth bug in its own workspace.' },
      },
    ],
    [phase, advance],
  )
  const current = scenes[scene % scenes.length] ?? scenes[0]
  React.useEffect(() => {
    if (current === undefined) return
    let id: number
    if (phase === 'idle') {
      if (typed < current.prompt.length) id = window.setTimeout(() => setTyped(value => value + 1), 45)
      else id = window.setTimeout(() => setPhase('thinking'), 350)
    } else if (phase === 'thinking') id = window.setTimeout(() => setPhase('view'), 1000)
    else if (phase === 'view') id = window.setTimeout(() => setPhase('done'), 3800)
    else
      id = window.setTimeout(() => {
        setScene(value => value + 1)
        setTyped(0)
        setPhase('idle')
      }, 2400)
    return () => window.clearTimeout(id)
  }, [phase, typed, current])
  if (current === undefined) return null
  return (
    <div className="dshx:flex dshx:min-h-80 dshx:items-center dshx:justify-center dshx:py-2 dshx:@max-pane-narrow:min-h-72">
      <ShapeshiftCard
        className="dshx:max-w-md"
        prompt={current.prompt.slice(0, typed)}
        onSubmit={() => setPhase('thinking')}
        onDismiss={() => {
          setTyped(0)
          setPhase('idle')
        }}
        phase={phase}
        view={current.view}
        done={current.done}
      />
    </div>
  )
}

// ── WorkflowRun ───────────────────────────────────────────────────────────────

const flowSteps: readonly FlowStep[] = [
  { id: 'when', kind: 'when', icon: <ListTodoIcon />, sentence: ['a backlog item is tagged', { token: '#bug' }] },
  {
    id: 'reproduce',
    kind: 'then',
    icon: <SparklesIcon />,
    sentence: ['reproduce it and pull', { token: 'file' }, { token: 'test' }, { token: 'severity' }],
    note: 'If no test fails, write one first. Keep the repro in its own jj workspace.',
  },
  { id: 'related', kind: 'then', icon: <SearchIcon />, sentence: ['find earlier threads that touched', { token: 'file' }] },
  {
    id: 'gate',
    kind: 'if',
    icon: <GitBranchIcon />,
    sentence: [{ token: 'severity' }, 'is', { token: 'high' }],
    branches: [
      { label: 'Yes', title: 'Wait for Maria to approve', detail: 'Reminds after 4 hours' },
      { label: 'No', title: 'Start the fix automatically', detail: 'Low risk, within budget' },
    ],
  },
  { id: 'fix', kind: 'then', icon: <BugIcon />, sentence: ['start a fix thread on a new revision'] },
  { id: 'post', kind: 'then', icon: <HashIcon />, sentence: ['post to', { token: '#triage' }, 'with the repro and a link'] },
]

function WorkflowRunDemo() {
  const tick = useTick(950) % 12
  const statusAt = (start: number): RunEntry['status'] => (tick < start ? 'pending' : tick === start ? 'running' : 'done')
  const gateStatus: RunEntry['status'] = tick < 6 ? 'pending' : 'waiting'
  const run: RunEntry[] = [
    { id: 'received', stepId: 'when', label: 'Item received', detail: 'b:212 · Login loops on refresh', status: tick < 1 ? 'running' : 'done', seconds: 0.1 },
    {
      id: 'reproduce',
      stepId: 'reproduce',
      label: 'Reproduced the bug',
      status: statusAt(2),
      seconds: tick < 2 ? 0 : tick === 2 ? 1.4 : 3.2,
      fields: [
        { key: 'file', value: 'auth/token.ts' },
        { key: 'test', value: 'refresh.test.ts' },
        { key: 'severity', value: 'high' },
      ],
    },
    {
      id: 'related',
      stepId: 'related',
      label: 'Found 2 threads',
      detail: 'Token refresh rework, Cookie domain fix',
      status: statusAt(5),
      seconds: tick <= 5 ? 0.4 : 1.1,
    },
    {
      id: 'gate',
      stepId: 'gate',
      label: 'Waiting for Maria',
      detail: tick >= 6 ? 'Severity high. Skipped in test mode.' : undefined,
      status: gateStatus,
      seconds: 0,
    },
    { id: 'fix', stepId: 'fix', label: 'Start fix thread', detail: 'Dry run, nothing started', status: 'pending' },
    { id: 'post', stepId: 'post', label: 'Post to #triage', detail: 'Dry run', status: 'pending' },
  ]
  const runState = tick >= 8 ? 'passed' : 'running'
  const flow = flowSteps.map(step => (step.id === 'gate' && tick >= 6 ? { ...step, taken: 0 as const } : step))
  return (
    <WorkflowRun
      heading="Bug intake"
      description="Turns #bug backlog items into reproduced fix threads. Risky ones wait for Maria."
      steps={flow}
      run={run}
      runState={runState}
      runSeconds={runState === 'passed' ? 8.4 : undefined}
      onRun={() => undefined}
      onAddStep={() => undefined}
    />
  )
}

export const agents2Demos: readonly GalleryDemo[] = [
  {
    id: 'agents-2-delegator-board',
    title: 'DelegatorBoard',
    description: 'The delegator agent’s overnight dashboard: a Now headline, what needs you, and every delegated thread with a live status tag.',
    source: "import { DelegatorBoard } from '@dshfiles/plugin-ui/components/motion/delegator-board'",
    wide: true,
    render: () => <DelegatorBoardDemo />,
  },
  {
    id: 'agents-2-step-trail',
    title: 'StepTrail',
    description: 'A thread’s plan as it runs: checks pop, the connector fills, the current step unfolds its substeps, gated steps show the approval they need.',
    source: "import { StepTrail } from '@dshfiles/plugin-ui/components/motion/step-trail'",
    render: () => <StepTrailDemo />,
  },
  {
    id: 'agents-2-agent-roster',
    title: 'AgentRoster',
    description: 'Parallel subagents at a glance, with a rolling running count, live activity, and a Review pill when one finishes.',
    source: "import { AgentRoster } from '@dshfiles/plugin-ui/components/motion/agent-roster'",
    render: () => <AgentRosterDemo />,
  },
  {
    id: 'agents-2-checkpoint-graph',
    title: 'CheckpointGraph',
    description: 'Git for an agent run: each checkpoint (a jj revision) on a lane graph, retries branching off the last good one, abandoned attempts greyed.',
    source: "import { CheckpointGraph } from '@dshfiles/plugin-ui/components/motion/checkpoint-graph'",
    wide: true,
    render: () => <CheckpointGraphDemo />,
  },
  {
    id: 'agents-2-context-graph',
    title: 'ContextGraph',
    description: 'The New thread composer as a node graph: project, branch and folders wired into the composer; pick a project to rewire it.',
    source: "import { ContextGraph } from '@dshfiles/plugin-ui/components/motion/context-graph'",
    wide: true,
    render: () => <ContextGraphDemo />,
  },
  {
    id: 'agents-2-shapeshift-card',
    title: 'ShapeshiftCard',
    description: 'One prompt that reshapes into the right UI (a cost readout, a New thread form) and collapses into a confirmation once the agent acts.',
    source: "import { ShapeshiftCard } from '@dshfiles/plugin-ui/components/motion/shapeshift-card'",
    render: () => <ShapeshiftDemo />,
  },
  {
    id: 'agents-2-workflow-run',
    title: 'WorkflowRun',
    description: 'A plain-sentence automation (backlog bug intake) with its test run: the highlight follows the executing step while the run log ticks.',
    source: "import { WorkflowRun } from '@dshfiles/plugin-ui/components/motion/workflow-run'",
    wide: true,
    render: () => <WorkflowRunDemo />,
  },
]
