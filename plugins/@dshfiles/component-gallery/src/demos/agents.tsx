import * as React from 'react'
import {
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  HashIcon,
  InboxIcon,
  LanguagesIcon,
  MailIcon,
  MessageSquareIcon,
  SparklesIcon,
} from '@dshfiles/plugin-ui/icons'
import { AgentCursors, AgentPresenceBar, type AgentCursor } from '@dshfiles/plugin-ui/components/motion/agent-cursors'
import { AgentQueue, type AgentQueueJob, type AgentQueueWorker } from '@dshfiles/plugin-ui/components/motion/agent-queue'
import { AgentRunSteps, type AgentRunStep } from '@dshfiles/plugin-ui/components/motion/agent-run-steps'
import { DelegationBoard, type DelegationAgent, type DelegationTask } from '@dshfiles/plugin-ui/components/motion/delegation-board'
import { RoutineList, type Routine } from '@dshfiles/plugin-ui/components/motion/routine-list'
import type { AgentTone } from '@dshfiles/plugin-ui/components/motion/agent-avatar'
import type { GalleryDemo } from './types.js'

/** setTimeout chain owned by one effect; cleared on unmount or replay. */
function useScript(run: (after: (ms: number, fn: () => void) => void) => void, deps: React.DependencyList) {
  React.useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    run(after)
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

function useInterval(ms: number, fn: () => void, active = true) {
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => {
    if (!active) return
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms, active])
}

// ── Agent run ────────────────────────────────────────────────────────────────

const RUN_SCRIPT: readonly Omit<AgentRunStep, 'status' | 'durationMs'>[] = [
  { id: 'plan', kind: 'plan', label: 'Planned the change', output: '1. Find the middleware chain\n2. Add a token bucket per API key\n3. Cover it with a test' },
  { id: 'read', kind: 'read', label: 'Read', target: 'src/api/routes.ts', output: '214 lines · 12 routes, 3 public' },
  { id: 'search', kind: 'search', label: 'Searching for', target: 'rate limit middleware', output: 'src/api/middleware/auth.ts\nsrc/api/middleware/cors.ts' },
  { id: 'edit', kind: 'edit', label: 'Edited', target: 'src/api/middleware/rate-limit.ts', output: '+48 −0 · token bucket, 60 req/min per key' },
  { id: 'run', kind: 'run', label: 'Ran', target: 'pnpm test api', output: '✓ 18 passed (1.9s)' },
]
const RUN_DURATIONS = [1200, 900, 1600, 2300, 1900]

function AgentRunDemo() {
  const [round, setRound] = React.useState(0)
  const [startedAt, setStartedAt] = React.useState(() => Date.now())
  const [endedAt, setEndedAt] = React.useState<number | undefined>(undefined)
  const [shown, setShown] = React.useState(0)
  const [doneCount, setDoneCount] = React.useState(0)
  useScript(
    after => {
      setStartedAt(Date.now())
      setEndedAt(undefined)
      setShown(0)
      setDoneCount(0)
      let at = 500
      RUN_DURATIONS.forEach((duration, index) => {
        after(at, () => setShown(index + 1))
        at += duration
        after(at, () => setDoneCount(index + 1))
        at += 250
      })
      after(at, () => setEndedAt(Date.now()))
      after(at + 4500, () => setRound(value => value + 1))
    },
    [round],
  )
  const steps: AgentRunStep[] = RUN_SCRIPT.slice(0, shown).map((step, index) => {
    if (index >= doneCount) return { ...step, status: 'running' }
    return { ...step, status: 'done', durationMs: RUN_DURATIONS[index] ?? 0 }
  })
  return (
    <AgentRunSteps
      heading="Add rate limiting to the public API"
      model={{ name: 'Sonnet 5.5', tone: 'chart-4' }}
      status={endedAt === undefined ? 'working' : 'done'}
      startedAt={startedAt}
      {...(endedAt === undefined ? {} : { endedAt })}
      steps={steps}
      onRestart={() => setRound(value => value + 1)}
    />
  )
}

// ── Agent queue ──────────────────────────────────────────────────────────────

const JOB_TEMPLATES: readonly Pick<AgentQueueJob, 'label' | 'tone' | 'icon'>[] = [
  { label: 'Classify 12 support emails', tone: 'violet', icon: SparklesIcon },
  { label: 'Triage new issues', tone: 'chart-5', icon: GitBranchIcon },
  { label: 'Open PR #500', tone: 'teal', icon: GitPullRequestIcon },
  { label: 'Run eval suite', tone: 'chart-3', icon: FlaskConicalIcon },
  { label: 'Translate release notes', tone: 'chart-1', icon: LanguagesIcon },
  { label: 'Draft reply – Acme', tone: 'violet', icon: MailIcon },
  { label: 'Post digest to #support', tone: 'chart-2', icon: HashIcon },
]
const WORKERS: readonly { id: string; name: string; tone: AgentTone }[] = [
  { id: 'w1', name: 'Sonnet 5.5', tone: 'chart-4' },
  { id: 'w2', name: 'GPT-6 Sol', tone: 'muted' },
  { id: 'w3', name: 'Gemini Flash', tone: 'chart-1' },
  { id: 'w4', name: 'Haiku 5', tone: 'chart-3' },
  { id: 'w5', name: 'DeepSeek V4', tone: 'teal' },
  { id: 'w6', name: 'Opus 5.5', tone: 'violet' },
]

interface QueueState {
  readonly waiting: readonly AgentQueueJob[]
  readonly workers: readonly AgentQueueWorker[]
  readonly done: number
  readonly failed: number
  readonly depth: readonly number[]
  readonly seq: number
  readonly landed: readonly number[]
  /** p95 of the waiting jobs' wait, sampled on each tick (reading the clock during render is impure). */
  readonly waitP95Ms: number
}

function waitP95(waiting: readonly AgentQueueJob[], now: number): number {
  const waits = waiting.map(job => now - job.enqueuedAt).sort((a, b) => a - b)
  return waits[Math.floor(waits.length * 0.95)] ?? 0
}

function makeJob(seq: number, now: number): AgentQueueJob {
  const template = JOB_TEMPLATES[seq % JOB_TEMPLATES.length] ?? JOB_TEMPLATES[0]!
  const job: AgentQueueJob = { id: `job-${seq}`, ...template, enqueuedAt: now - Math.round(Math.random() * 400) }
  if (seq % 9 === 4) return { ...job, priority: true }
  return job
}

function AgentQueueDemo() {
  const [paused, setPaused] = React.useState(false)
  const [concurrency, setConcurrency] = React.useState(4)
  const [state, setState] = React.useState<QueueState>(() => {
    const now = Date.now()
    const waiting = [0, 1, 2].map(n => makeJob(n, now - n * 900))
    return {
      waiting,
      waitP95Ms: waitP95(waiting, now),
      workers: WORKERS.slice(0, 4).map(worker => ({ ...worker })),
      done: 134,
      failed: 3,
      depth: Array.from({ length: 48 }, (_, i) => Math.max(0, Math.round(8 + 7 * Math.sin(i / 5) + Math.random() * 3))),
      seq: 3,
      landed: [],
    }
  })
  useInterval(900, () =>
    setState(previous => {
      const now = Date.now()
      let seq = previous.seq
      let waiting = [...previous.waiting]
      let done = previous.done
      let failed = previous.failed
      const landed = previous.landed.filter(at => now - at < 60_000)
      // Arrivals come in bursts.
      const phase = Math.sin(now / 9000)
      const arrivals = Math.random() < 0.55 + phase * 0.35 ? (Math.random() < 0.3 ? 2 : 1) : 0
      for (let i = 0; i < arrivals; i++) waiting.push(makeJob(seq++, now))
      const workers = WORKERS.slice(0, concurrency).map(base => {
        const current = previous.workers.find(worker => worker.id === base.id)
        let worker: AgentQueueWorker = current ? { ...current } : { ...base }
        if (worker.job) {
          const progress = (worker.job.progress ?? 0) + 0.18 + Math.random() * 0.22
          if (progress >= 1) {
            const ok = Math.random() > 0.06
            if (ok) done++
            else failed++
            landed.push(now)
            const idle: AgentQueueWorker = { id: worker.id, name: worker.name, lastOutcome: ok ? 'done' : 'failed' }
            worker = worker.tone ? { ...idle, tone: worker.tone } : idle
          } else worker = { ...worker, job: { ...worker.job, progress } }
        }
        if (!worker.job && !paused && waiting.length > 0) {
          const [next, ...rest] = waiting
          waiting = rest
          if (next) worker = { ...worker, job: { ...next, startedAt: now, progress: 0.05 } }
        }
        return worker
      })
      return { waiting, workers, done, failed, depth: [...previous.depth.slice(1), waiting.length], seq, landed, waitP95Ms: waitP95(waiting, now) }
    }),
  )
  return (
    <AgentQueue
      name="agent-jobs"
      paused={paused}
      onPausedChange={setPaused}
      concurrency={concurrency}
      onConcurrencyChange={setConcurrency}
      maxConcurrency={WORKERS.length}
      waiting={state.waiting}
      workers={state.workers}
      done={state.done}
      failed={state.failed}
      throughputPerMin={Math.max(state.landed.length, 0)}
      waitP95Ms={Math.max(state.waitP95Ms, 13_000 * (state.waiting.length > 6 ? 1.4 : 1))}
      depthHistory={state.depth}
      depthTarget={12}
      historySeconds={Math.round((state.depth.length * 900) / 1000)}
    />
  )
}

// ── Routines ─────────────────────────────────────────────────────────────────

const runs = (prefix: string, pattern: string) =>
  Array.from(pattern).map((c, i) => ({
    id: `${prefix}-${i}`,
    status: c === 'x' ? ('failed' as const) : c === '-' ? ('skipped' as const) : ('ok' as const),
    label: `Run ${i + 1}`,
  }))

function initialRoutines(): Routine[] {
  const now = Date.now()
  return [
    {
      id: 'triage',
      name: 'Morning triage',
      schedule: 'Weekdays at 9:00',
      enabled: true,
      nextRunAt: now + (2 * 3600 + 14 * 60) * 1000,
      lastRun: { label: 'yesterday 9:00', ok: true },
      history: runs('triage', 'oooo-oooxooo'),
      sources: [
        { label: 'Backlog inbox', icon: InboxIcon, tone: 'violet' },
        { label: 'Issues', icon: GitBranchIcon },
      ],
      destination: { label: '#triage', icon: HashIcon },
      agent: { name: 'Sonnet', tone: 'chart-4' },
    },
    {
      id: 'digest',
      name: 'Merged PR digest',
      schedule: 'Fridays at 16:00',
      enabled: true,
      nextRunAt: now + (3 * 86_400 + 9 * 3600) * 1000,
      lastRun: { label: 'Fri 16 Oct, 16:00', ok: true },
      history: runs('digest', 'oooo-ooooooo'),
      sources: [{ label: 'Pull requests', icon: GitPullRequestIcon }],
      destination: { label: '#eng', icon: HashIcon },
      agent: { name: 'Opus', tone: 'violet' },
    },
    {
      id: 'incidents',
      name: 'Incident watch',
      schedule: 'Every hour at :00',
      enabled: true,
      nextRunAt: now + (14 * 60 + 27) * 1000,
      lastRun: { label: 'today 6:00', ok: true },
      history: runs('incidents', '-o--ox----oo'),
      sources: [
        { label: 'Alerts', icon: BellIcon, tone: 'chart-4' },
        { label: 'Deploys', icon: GitBranchIcon },
      ],
      destination: { label: '#incidents', icon: HashIcon },
      agent: { name: 'GPT', tone: 'muted' },
    },
    {
      id: 'meeting',
      name: 'Meeting prep',
      schedule: 'Weekdays at 8:30',
      enabled: true,
      nextRunAt: now + (1 * 3600 + 44 * 60) * 1000,
      lastRun: { label: 'Thu 15 Oct, 8:30', ok: true },
      history: runs('meeting', 'oooooooooooo'),
      sources: [
        { label: 'Calendar', icon: CalendarIcon, tone: 'chart-1' },
        { label: 'Notes', icon: BookOpenIcon },
      ],
      destination: { label: 'DM', icon: MessageSquareIcon },
      agent: { name: 'Gemini', tone: 'chart-1' },
    },
  ]
}

function RoutinesDemo() {
  const [routines, setRoutines] = React.useState<Routine[]>(initialRoutines)
  const counter = React.useRef(0)
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>())
  React.useEffect(() => {
    const set = timers.current
    return () => set.forEach(clearTimeout)
  }, [])
  const patch = (id: string, fn: (routine: Routine) => Routine) => setRoutines(list => list.map(routine => (routine.id === id ? fn(routine) : routine)))
  const runNow = (id: string) => {
    patch(id, routine => ({ ...routine, running: true }))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      const ok = Math.random() > 0.15
      patch(id, routine => ({
        ...routine,
        running: false,
        lastRun: { label: 'just now', ok },
        history: [...routine.history.slice(-11), { id: `${id}-now-${counter.current++}`, status: ok ? 'ok' : 'failed', label: 'just now' }],
      }))
    }, 2400)
    timers.current.add(timer)
  }
  // Loop: one enabled routine fires on its own every few seconds so the strip keeps moving.
  useInterval(6500, () => {
    const enabled = routines.filter(routine => routine.enabled && !routine.running)
    const pick = enabled[Math.floor(Math.random() * enabled.length)]
    if (pick) runNow(pick.id)
  })
  return (
    <RoutineList routines={routines} onToggle={(id, enabled) => patch(id, routine => ({ ...routine, enabled }))} onRunNow={runNow} onNew={() => undefined} />
  )
}

// ── Agent cursors ────────────────────────────────────────────────────────────

interface CursorPlan {
  readonly id: string
  readonly name: string
  readonly tone: AgentTone
  readonly route: readonly { readonly anchor: string; readonly status: string }[]
}

const CURSOR_PLANS: readonly CursorPlan[] = [
  {
    id: 'writer',
    name: 'Writer',
    tone: 'violet',
    route: [
      { anchor: 'title', status: 'Finding a sharper title' },
      { anchor: 'title', status: 'Renaming' },
      { anchor: 'lead', status: 'Tightening the lead' },
    ],
  },
  {
    id: 'researcher',
    name: 'Researcher',
    tone: 'chart-4',
    route: [
      { anchor: 'stat', status: 'Checking the numbers' },
      { anchor: 'stat', status: 'Fixing the number' },
      { anchor: 'title', status: 'Reading on' },
    ],
  },
  {
    id: 'coder',
    name: 'Coder',
    tone: 'teal',
    route: [
      { anchor: 'date', status: 'Fixing the date' },
      { anchor: 'date', status: 'Checking the rest' },
      { anchor: 'waitlist', status: 'Matching formats' },
    ],
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    tone: 'chart-1',
    route: [
      { anchor: 'ships', status: 'Reading the doc' },
      { anchor: 'lead', status: 'Looks right' },
      { anchor: 'ships', status: 'Waiting for edits' },
    ],
  },
]

function CursorsDemo() {
  const surface = React.useRef<HTMLDivElement>(null)
  const [step, setStep] = React.useState(0)
  const [costs, setCosts] = React.useState<Record<string, number>>(() => Object.fromEntries(CURSOR_PLANS.map((plan, i) => [plan.id, 0.04 + i * 0.03])))
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({})
  const [accepted, setAccepted] = React.useState(false)
  useInterval(1900, () => {
    setStep(value => value + 1)
    setCosts(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, value + 0.01 + Math.random() * 0.03])))
  })
  const phase = step % 6
  React.useEffect(() => {
    if (phase === 0) setAccepted(false)
  }, [phase])
  const edits = accepted ? 0 : Math.min(3, Math.floor(phase / 1.5))

  React.useLayoutEffect(() => {
    const root = surface.current
    if (root == null) return
    const box = root.getBoundingClientRect()
    const next: Record<string, { x: number; y: number }> = {}
    CURSOR_PLANS.forEach((plan, index) => {
      const hop = plan.route[(step + index) % plan.route.length]
      const anchor = hop ? root.querySelector<HTMLElement>(`[data-anchor="${hop.anchor}"]`) : null
      if (anchor == null) return
      const rect = anchor.getBoundingClientRect()
      const jitter = ((step * 37 + index * 53) % 40) - 10
      next[plan.id] = { x: Math.min(box.width - 40, rect.left - box.left + Math.max(0, rect.width * 0.6 + jitter)), y: rect.top - box.top + rect.height * 0.7 }
    })
    setPositions(next)
  }, [step, edits])

  const cursors: AgentCursor[] = CURSOR_PLANS.flatMap((plan, index) => {
    const position = positions[plan.id]
    const hop = plan.route[(step + index) % plan.route.length]
    if (position === undefined || hop === undefined) return []
    // The reviewer steps out every other loop to show enter/exit.
    if (plan.id === 'reviewer' && phase >= 4) return []
    return [{ id: plan.id, name: plan.name, tone: plan.tone, status: hop.status, cost: costs[plan.id] ?? 0, x: position.x, y: position.y }]
  })
  const total = Object.values(costs).reduce((sum, value) => sum + value, 0)

  const swap = (from: string, to: string, on: boolean) =>
    on ? (
      <>
        <span className="dshx:text-muted-foreground dshx:line-through dshx:decoration-muted-foreground/60">{from}</span>{' '}
        <span className="dshx:rounded-sm dshx:bg-violet/10 dshx:underline dshx:decoration-violet dshx:underline-offset-4">{to}</span>
      </>
    ) : (
      from
    )

  return (
    <div className="dshx:flex dshx:flex-col dshx:gap-3 dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card">
      <div className="dshx:flex dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3 dshx:py-2">
        <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">Product / Launches</span>
        <AgentPresenceBar
          className="dshx:ml-auto"
          agents={CURSOR_PLANS.map(plan => ({ id: plan.id, name: plan.name, tone: plan.tone, active: cursors.some(cursor => cursor.id === plan.id) }))}
          suggestions={edits}
          cost={total}
          onAcceptAll={() => setAccepted(true)}
        />
      </div>
      {/* The padding lives on the measured surface so cursor coordinates and the overlay share one origin. */}
      <AgentCursors cursors={cursors}>
        <div ref={surface} className="dshx:flex dshx:flex-col dshx:gap-3 dshx:px-5 dshx:pb-6 dshx:text-sm dshx:@max-pane-narrow:px-3">
          <h3 className="dshx:text-lg dshx:font-semibold">
            Pulse 2.0 – launch <span data-anchor="title">{swap('brief', 'plan', edits >= 2)}</span>
          </h3>
          <p data-anchor="lead" className="dshx:text-muted-foreground">
            Teams lose <span data-anchor="stat">{swap('about 40%', '38%', edits >= 1)}</span> of their week to status updates. Pulse turns that work into a
            short daily brief.
          </p>
          <pre className="dshx:rounded-md dshx:bg-muted dshx:px-3 dshx:py-2 dshx:font-mono dshx:text-xs dshx:break-words dshx:whitespace-pre-wrap">
            {'const rollout = {\n  '}
            <span data-anchor="waitlist">waitlist: "Nov 3",</span>
            {'\n  everyone: "'}
            <span data-anchor="date">{swap('second week of November', 'Nov 10', edits >= 3)}</span>
            {'",\n}'}
          </pre>
          <p data-anchor="ships" className="dshx:text-muted-foreground">
            What ships: daily briefs for every project, and nudges when a task has been quiet too long.
          </p>
        </div>
      </AgentCursors>
    </div>
  )
}

// ── Delegation board ─────────────────────────────────────────────────────────

const TASK_POOL: readonly DelegationTask[] = [
  { id: 't-flaky', title: 'Fix flaky checkout test', estimateMin: 20, sources: [{ label: 'Repository', icon: GitBranchIcon }] },
  {
    id: 't-churn',
    title: 'Summarize churn calls',
    estimateMin: 15,
    sources: [
      { label: 'Chat', icon: MessageSquareIcon },
      { label: 'Notes', icon: BookOpenIcon },
    ],
  },
  { id: 't-pricing', title: 'Update pricing page', estimateMin: 10, sources: [{ label: 'Design file', icon: SparklesIcon }] },
  { id: 't-crm', title: 'Clean up CRM duplicates', estimateMin: 18, sources: [{ label: 'Database', icon: DatabaseIcon }] },
]

const AGENTS: readonly DelegationAgent[] = [
  { id: 'a-research', name: 'Researcher', model: 'Opus 5.5', ratePerMin: 0.08, tone: 'chart-4' },
  { id: 'a-writer', name: 'Writer', model: 'Sonnet 5.5', ratePerMin: 0.03, tone: 'violet' },
  { id: 'a-coder', name: 'Coder', model: 'GPT-6 Sol', ratePerMin: 0.06, tone: 'muted' },
  { id: 'a-ops', name: 'Ops', model: 'Gemini Flash', ratePerMin: 0.01, tone: 'chart-1' },
]

const clockIn = (minutes: number) => {
  const at = new Date(Date.now() + minutes * 60_000)
  return `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

interface BoardState {
  readonly unassigned: readonly DelegationTask[]
  readonly agents: readonly DelegationAgent[]
}

function initialBoard(): BoardState {
  return {
    unassigned: [...TASK_POOL],
    agents: AGENTS.map(agent =>
      agent.id === 'a-research'
        ? {
            ...agent,
            active: { id: 't-scan', title: 'Competitor scan', estimateMin: 25 },
            queued: [{ id: 't-notes', title: 'Write release notes', estimateMin: 12, sources: [{ label: 'Notes', icon: BookOpenIcon }] }],
            busyUntil: clockIn(25),
          }
        : agent.id === 'a-coder'
          ? {
              ...agent,
              active: { id: 't-auth', title: 'Refactor auth', estimateMin: 30 },
              queued: [{ id: 't-sdk', title: 'Upgrade payments SDK', estimateMin: 20, sources: [{ label: 'Repository', icon: GitBranchIcon }] }],
              busyUntil: clockIn(30),
            }
          : { ...agent },
    ),
  }
}

function DelegationDemo() {
  const [board, setBoard] = React.useState(initialBoard)
  const [auto, setAuto] = React.useState(false)
  const assign = (taskId: string, agentId: string) =>
    setBoard(previous => {
      const task = previous.unassigned.find(candidate => candidate.id === taskId)
      if (task === undefined) return previous
      return {
        unassigned: previous.unassigned.filter(candidate => candidate.id !== taskId),
        agents: previous.agents.map(agent => {
          if (agent.id !== agentId) return agent
          const queued = agent.queued ?? []
          const minutes = (agent.active?.estimateMin ?? 0) + queued.reduce((sum, item) => sum + item.estimateMin, 0) + task.estimateMin
          return agent.active ? { ...agent, queued: [...queued, task], busyUntil: clockIn(minutes) } : { ...agent, active: task, busyUntil: clockIn(minutes) }
        }),
      }
    })
  // Agents finish work; Auto hands out the next task; the board refills when empty so the demo loops.
  useInterval(2600, () =>
    setBoard(previous => {
      const busy = previous.agents.filter(agent => agent.active)
      const finisher = busy[Math.floor(Math.random() * busy.length)]
      const agents = previous.agents.map(agent => {
        if (agent !== finisher || Math.random() < 0.35) return agent
        const [next, ...rest] = agent.queued ?? []
        const { active: _active, busyUntil: _until, ...idle } = agent
        return next ? { ...agent, active: next, queued: rest } : { ...idle, queued: [] }
      })
      const allIdle = agents.every(agent => !agent.active) && previous.unassigned.length === 0
      return allIdle ? initialBoard() : { ...previous, agents }
    }),
  )
  useInterval(
    1500,
    () => {
      const task = board.unassigned[0]
      if (task === undefined) return
      const target = [...board.agents].sort((a, b) => (a.active ? 1 : 0) + (a.queued?.length ?? 0) - ((b.active ? 1 : 0) + (b.queued?.length ?? 0)))[0]
      if (target) assign(task.id, target.id)
    },
    auto,
  )
  const queuedCost = board.agents.reduce(
    (sum, agent) => sum + agent.ratePerMin * ((agent.active?.estimateMin ?? 0) + (agent.queued ?? []).reduce((total, task) => total + task.estimateMin, 0)),
    0,
  )
  return <DelegationBoard unassigned={board.unassigned} agents={board.agents} auto={auto} onAutoChange={setAuto} onAssign={assign} queuedCost={queuedCost} />
}

export const agentsDemos: readonly GalleryDemo[] = [
  {
    id: 'agents-run-steps',
    title: 'AgentRunSteps',
    description: 'A subagent or thread turn as live steps: shimmering current tool, ticking clock, popped checks and expandable output.',
    source: "import { AgentRunSteps } from '@dshfiles/plugin-ui/components/motion/agent-run-steps'",
    render: () => <AgentRunDemo />,
  },
  {
    id: 'agents-queue',
    title: 'AgentQueue',
    description: 'Background jobs and subagent fan-out: waiting jobs tick, workers pick them up, landings fly to the done tally and the depth chart scrolls.',
    source: "import { AgentQueue } from '@dshfiles/plugin-ui/components/motion/agent-queue'",
    wide: true,
    render: () => <AgentQueueDemo />,
  },
  {
    id: 'agents-routines',
    title: 'RoutineList',
    description: 'Scheduled agent threads (triage, digests, watches) with live countdowns, a pause switch, Run now on hover and a run-history strip.',
    source: "import { RoutineList } from '@dshfiles/plugin-ui/components/motion/routine-list'",
    wide: true,
    render: () => <RoutinesDemo />,
  },
  {
    id: 'agents-cursors',
    title: 'AgentCursors',
    description:
      'Watch parallel subagents work on one document: spring-gliding cursors with name, rolling cost and status, plus the presence bar with Accept all.',
    source: "import { AgentCursors, AgentPresenceBar } from '@dshfiles/plugin-ui/components/motion/agent-cursors'",
    wide: true,
    render: () => <CursorsDemo />,
  },
  {
    id: 'agents-delegation',
    title: 'DelegationBoard',
    description: 'Hand backlog items to agents by drag or menu: cards glide into an agent lane, Free flips to Busy, and Auto assigns by itself.',
    source: "import { DelegationBoard } from '@dshfiles/plugin-ui/components/motion/delegation-board'",
    wide: true,
    render: () => <DelegationDemo />,
  },
]
