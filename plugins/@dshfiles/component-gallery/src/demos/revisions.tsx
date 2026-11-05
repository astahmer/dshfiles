import * as React from 'react'
import { RevisionScrubber, type ScrubberItem } from '@dshfiles/plugin-ui/components/motion/revision-scrubber'
import { MergeConflictGraph, type MergeRevision, type MergeTargetStatus } from '@dshfiles/plugin-ui/components/motion/merge-conflict-graph'
import { MergeChecks, type MergeCheck, type MergeState } from '@dshfiles/plugin-ui/components/motion/merge-checks'
import { PipelineDag, type PipelineStep } from '@dshfiles/plugin-ui/components/motion/pipeline-dag'
import { CallStackTree, type CallFrame } from '@dshfiles/plugin-ui/components/motion/call-stack-tree'
import { RevisionAvatarGraph, type AvatarGraphEntry } from '@dshfiles/plugin-ui/components/motion/revision-avatar-graph'
import { useElapsed } from '@dshfiles/plugin-ui/motion/react'
import { BookmarkIcon, BotIcon, GitMergeIcon } from '@dshfiles/plugin-ui/icons'
import type { GalleryDemo } from './types.js'

/** Steps through `durations` (ms per phase) and loops; the setter lets a click jump ahead. */
function usePhases(durations: readonly number[]): readonly [number, (phase: number) => void] {
  const [phase, setPhase] = React.useState(0)
  React.useEffect(() => {
    const duration = durations[phase]
    if (duration === undefined) return
    const timer = setTimeout(() => setPhase(current => (current + 1) % durations.length), duration)
    return () => clearTimeout(timer)
  }, [phase, durations])
  return [phase, setPhase] as const
}

// ── RevisionScrubber ──────────────────────────────────────────────────────────

const scrubberTitles = [
  'feat(chat): stream tool output',
  'fix(jj): rebase onto moved main',
  'chore: bump motion to 14.9',
  'feat(backlog): triage proposals',
  'refactor(ui): lane graph cells',
  'fix(memory): digest race',
  'feat(traces): alert rules',
  'docs: plugin boundaries',
  'feat(gallery): revisions tab',
  'fix(composer): model chip wraps',
  'perf(sidebar): virtualise threads',
  'feat(usage): cost by purpose',
]
const scrubberItems: readonly ScrubberItem[] = Array.from({ length: 42 }, (_, i) => {
  const day = 3 + Math.floor(i / 3)
  const title = scrubberTitles[i % scrubberTitles.length] ?? 'change'
  const kind = i % 7 === 0 ? 'landed' : i % 5 === 0 ? 'bookmark' : 'agent'
  return {
    id: `rev-${i}`,
    label: `Oct ${day}`,
    title,
    subtitle: kind === 'landed' ? 'landed on main' : kind === 'bookmark' ? 'bookmark moved' : `@luna · ${(i % 4) + 1} files`,
    major: i % 3 === 0,
    glyph:
      kind === 'landed' ? (
        <GitMergeIcon className="dshx:size-6" />
      ) : kind === 'bookmark' ? (
        <BookmarkIcon className="dshx:size-6" />
      ) : (
        <BotIcon className="dshx:size-6" />
      ),
  }
})

function RevisionScrubberDemo() {
  const [value, setValue] = React.useState(6)
  const [userUntil, setUserUntil] = React.useState(0)
  React.useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < userUntil) return
      setValue(current => {
        const jump = Math.random() < 0.25 ? 5 + Math.floor(Math.random() * 8) : 1
        const next = current + jump
        return next >= scrubberItems.length ? 0 : next
      })
    }, 850)
    return () => clearInterval(timer)
  }, [userUntil])
  return (
    <RevisionScrubber
      items={scrubberItems}
      value={value}
      label="Thread revisions"
      onValueChange={index => {
        setValue(index)
        setUserUntil(Date.now() + 5000)
      }}
    />
  )
}

// ── MergeConflictGraph ────────────────────────────────────────────────────────

const baseRevisions: readonly MergeRevision[] = [
  {
    id: 'd29f50',
    title: 'Add token refresh tests',
    bookmark: 'feat/token-refresh',
    hash: 'd29f50',
    author: 'You',
    age: 'now',
    lane: 1,
    parents: ['c70a92'],
  },
  { id: 'c70a92', title: 'Refresh tokens near expiry', hash: 'c70a92', author: 'You', age: '25m', lane: 1, parents: ['1f8e3b'] },
  {
    id: 'e83c51',
    title: 'Add analytics consent banner',
    bookmark: 'feat/checkout-analytics',
    hash: 'e83c51',
    author: 'Sam',
    age: '32m',
    lane: 2,
    parents: ['62b0e4'],
    muted: true,
  },
  { id: '1f8e3b', title: 'Read token expiry from the token', hash: '1f8e3b', author: 'You', age: '40m', lane: 1, parents: ['9c2d4a'] },
  { id: '62b0e4', title: 'Track checkout funnel events', hash: '62b0e4', author: 'Sam', age: '2h', lane: 2, parents: ['9c2d4a'], muted: true },
  { id: '9c2d4a', title: 'Bump next to 16.3', hash: '9c2d4a', author: 'Sam', age: '3h', lane: 0, parents: [], muted: true },
]

// checking, conflicts, resolving start, 3 progress steps, resolved, ready
const conflictPhases = [1400, 3200, 700, 700, 700, 900, 1100, 3200] as const

interface ConflictScene {
  readonly revisions: readonly MergeRevision[]
  readonly status: MergeTargetStatus
  readonly statusText?: string
}

function conflictScene(phase: number): ConflictScene {
  if (phase === 0) {
    return {
      revisions: baseRevisions.map(rev => (rev.id === '9c2d4a' ? { ...rev, bookmark: 'main' } : rev)),
      status: 'checking',
      statusText: 'Comparing with main',
    }
  }
  const resolvedA = phase >= 3
  const resolvedB = phase >= 4
  const progress = [0, 0, 0, 14, 30, 42, 42, 42][phase] ?? 42
  const mainMoved: MergeRevision[] = [
    {
      id: '5be27d',
      title: 'Read tokens with the current key',
      bookmark: 'main',
      hash: '5be27d',
      author: 'Lena',
      age: '6m',
      lane: 0,
      parents: ['a3f9c1'],
      muted: true,
      conflicts: 1,
      resolved: resolvedB,
    },
    {
      id: 'a3f9c1',
      title: 'Rotate token keys',
      hash: 'a3f9c1',
      author: 'Lena',
      age: '18m',
      lane: 0,
      parents: ['9c2d4a'],
      muted: true,
      conflicts: 2,
      resolved: resolvedA,
    },
  ]
  const [tests, refresh, ...rest] = baseRevisions
  const revisions: MergeRevision[] = [...(tests ? [tests] : []), ...mainMoved, ...(refresh ? [refresh] : []), ...rest]
  if (phase >= 2) {
    const merge = {
      id: 'merge',
      title: 'Merge main into feat/token-refresh',
      bookmark: 'feat/token-refresh',
      hash: '7e0c3b',
      author: 'You',
      age: 'now',
      lane: 1,
      parents: ['d29f50', '5be27d'],
      node: phase >= 7 ? 'dot' : 'working',
    } as const satisfies MergeRevision
    revisions.unshift(phase < 7 ? { ...merge, progress: { done: progress, total: 42 } } : merge)
    if (tests) revisions[1] = withoutBookmark(tests)
  }
  const unresolved = (resolvedA ? 0 : 2) + (resolvedB ? 0 : 1)
  if (phase === 1) return { revisions, status: 'conflicts' }
  if (phase <= 5) return { revisions, status: 'resolving', statusText: `Running ${progress} of 42 tests · ${unresolved} hunks left` }
  if (phase === 6) return { revisions, status: 'resolved', statusText: 'All 3 conflicts resolved' }
  return { revisions, status: 'ready', statusText: 'Merged main · 42 tests passed' }
}

function MergeConflictGraphDemo() {
  const [phase, setPhase] = usePhases(conflictPhases)
  const scene = conflictScene(phase)
  const conflicts = scene.revisions.reduce((sum, rev) => sum + (rev.resolved || typeof rev.conflicts !== 'number' ? 0 : rev.conflicts), 0)
  return (
    <MergeConflictGraph
      heading="Refresh tokens in the auth middleware"
      number="#128"
      target={{ label: 'Merge into main', status: scene.status, conflicts }}
      revisions={scene.revisions}
      {...(scene.statusText === undefined ? {} : { statusText: scene.statusText })}
      onResolve={() => setPhase(2)}
    />
  )
}

function withoutBookmark(rev: MergeRevision): MergeRevision {
  const { bookmark: _bookmark, ...rest } = rev
  return rest
}

// ── MergeChecks ───────────────────────────────────────────────────────────────

const landedRevisions: readonly MergeRevision[] = [
  {
    id: 'merge',
    title: 'Merge main into feat/token-refresh',
    bookmark: 'feat/token-refresh',
    hash: '7e0c3b',
    author: 'You',
    age: 'now',
    lane: 1,
    parents: ['d29f50', '5be27d'],
    node: 'ring',
  },
  { id: 'd29f50', title: 'Add token refresh tests', hash: 'd29f50', author: 'You', age: 'now', lane: 1, parents: ['c70a92'] },
  {
    id: '5be27d',
    title: 'Read tokens with the current key',
    bookmark: 'main',
    hash: '5be27d',
    author: 'Lena',
    age: '6m',
    lane: 0,
    parents: ['a3f9c1'],
    muted: true,
  },
  { id: 'a3f9c1', title: 'Rotate token keys', hash: 'a3f9c1', author: 'Lena', age: '18m', lane: 0, parents: ['9c2d4a'], muted: true },
  { id: 'c70a92', title: 'Refresh tokens near expiry', hash: 'c70a92', author: 'You', age: '25m', lane: 1, parents: ['9c2d4a'] },
  { id: '9c2d4a', title: 'Bump next to 16.3', hash: '9c2d4a', author: 'Sam', age: '3h', lane: 0, parents: [], muted: true },
]

// queued, tests run, lint, types, preview, ready, merging, merged
const checkPhases = [700, 1400, 700, 700, 1100, 2600, 1200, 2600] as const

interface ChecksScene {
  readonly checks: readonly MergeCheck[]
  readonly state: MergeState
}

function checksScene(phase: number): ChecksScene {
  const at = (done: number, running: number) => (phase >= done ? 'passed' : phase >= running ? 'running' : 'queued')
  const checks: MergeCheck[] = [
    { id: 'tests', label: 'Tests', status: at(2, 1), detail: phase >= 2 ? '42 passed' : 'running', summary: 'vitest · 42 passed, 0 failed', duration: '38s' },
    { id: 'lint', label: 'Lint', status: at(3, 1), detail: phase >= 3 ? 'passed' : 'running', summary: 'eslint · no problems', duration: '9s' },
    { id: 'types', label: 'Types', status: at(4, 2), detail: phase >= 4 ? 'passed' : 'running', summary: 'tsc --noEmit · 0 errors', duration: '21s' },
    {
      id: 'preview',
      label: 'Preview',
      status: at(5, 3),
      detail: phase >= 5 ? 'ready' : 'deploying',
      summary: 'Deployed to token-refresh.preview',
      duration: '1m 4s',
    },
  ]
  return { checks, state: mergeStateAt(phase) }
}

function mergeStateAt(phase: number): MergeState {
  if (phase >= 7) return 'merged'
  if (phase === 6) return 'merging'
  if (phase === 5) return 'ready'
  return 'blocked'
}

function MergeChecksDemo() {
  const [phase, setPhase] = usePhases(checkPhases)
  const scene = checksScene(phase)
  const merged = scene.state === 'merged'
  return (
    <MergeConflictGraph
      heading="Refresh tokens in the auth middleware"
      number="#128"
      state={merged ? { label: 'Merged', tone: 'violet' } : { label: 'Open', tone: 'success' }}
      target={{ label: 'Merge into main', status: merged ? 'merged' : 'ready' }}
      revisions={landedRevisions}
      footer={<MergeChecks checks={scene.checks} state={scene.state} onMerge={() => setPhase(6)} />}
    />
  )
}

// ── PipelineDag ───────────────────────────────────────────────────────────────

interface Planned {
  readonly id: string
  readonly label: string
  readonly prefix?: string
  readonly lane: number
  readonly after: readonly string[]
  readonly start: number
  readonly end: number
  readonly total?: number
  readonly skipped?: boolean
  readonly log: string
}

const landingPlan: readonly Planned[] = [
  { id: 'fetch', label: 'Fetch main', lane: 1, after: [], start: 0, end: 4, total: 1200, log: 'jj git fetch · 1.2K objects' },
  { id: 'rebase', label: 'Rebase thread', prefix: '+', lane: 0, after: ['fetch'], start: 4, end: 6, log: 'rebased 4 revisions onto main' },
  { id: 'deps', label: 'install deps', prefix: '+', lane: 1, after: ['fetch'], start: 4, end: 8, log: 'pnpm install --frozen-lockfile' },
  { id: 'wait', label: 'Wait for inputs', lane: 1, after: ['rebase', 'deps'], start: 8, end: 9, log: 'inputs ready' },
  { id: 'check', label: 'Typecheck plugins', lane: 1, after: ['wait'], start: 9, end: 13, total: 3, log: 'tsc -p plugins/@dshfiles/*' },
  { id: 'clean', label: 'Conflicts?', lane: 1, after: ['check'], start: 13, end: 14, log: 'jj log -r conflicts() · none' },
  { id: 'land', label: 'Advance main', prefix: 'ok', lane: 0, after: ['clean'], start: 14, end: 16, log: 'main → 7e0c3b' },
  { id: 'park', label: 'Park thread', prefix: 'conflict', lane: 1, after: ['clean'], start: 14, end: 14, skipped: true, log: 'skipped: no conflicts' },
  { id: 'record', label: 'Record review range', lane: 1, after: ['land', 'park'], start: 16, end: 17.5, log: 'review range saved for thread' },
]

function plannedStepState(plan: Planned, t: number): PipelineStep['state'] {
  if (plan.skipped) return t >= plan.start ? 'skipped' : 'pending'
  if (t < plan.start) return 'pending'
  if (t < plan.end) return 'running'
  return 'ok'
}

function PipelineRun({ onDone }: { readonly onDone: () => void }) {
  const raw = useElapsed(true)
  const t = raw * 1.2
  const end = 19
  React.useEffect(() => {
    if (t >= end) onDone()
  }, [t, onDone])
  const steps: PipelineStep[] = landingPlan.map(plan => {
    const state = plannedStepState(plan, t)
    const fraction = Math.max(0, Math.min(1, (t - plan.start) / Math.max(0.01, plan.end - plan.start)))
    const base = { id: plan.id, label: plan.label, lane: plan.lane, after: plan.after, state } satisfies PipelineStep
    const labelled = plan.prefix ? { ...base, prefix: plan.prefix } : base
    const counted =
      plan.total !== undefined && state !== 'pending' ? { ...labelled, progress: { done: Math.round(fraction * plan.total), total: plan.total } } : labelled
    return state === 'pending' || plan.skipped ? counted : { ...counted, start: plan.start, end: Math.min(t, plan.end) }
  })
  const current = [...landingPlan].reverse().find(plan => t >= plan.start)
  const finished = t >= 17.5
  return (
    <PipelineDag
      heading="land thread-025a80"
      subtitle="#48 · attempt 1"
      steps={steps}
      elapsed={Math.min(t, 17.5)}
      status={finished ? 'ok' : 'running'}
      warnings={t >= 6 ? 1 : 0}
      {...(current ? { latest: { at: `${Math.floor(current.start)}s`, step: current.label, text: current.log } } : {})}
    />
  )
}

function PipelineDagDemo() {
  const [run, setRun] = React.useState(0)
  const next = React.useCallback(() => setRun(value => value + 1), [])
  return <PipelineRun key={run} onDone={next} />
}

// ── CallStackTree ─────────────────────────────────────────────────────────────

const callRoots: readonly CallFrame[] = [
  {
    id: 'create',
    receiver: 'Schedule',
    name: 'create',
    args: 'input',
    file: 'schedule.ts',
    line: 620,
    status: 'existing',
    children: [
      {
        id: 'validate',
        receiver: 'ScheduleCheck',
        name: 'validate',
        args: 'condition',
        file: 'check.ts',
        line: 70,
        status: 'new',
        children: [{ id: 'scan', receiver: 'CodeMode', name: 'scanTools', args: 'code', file: 'scan.ts', line: 11, status: 'new' }],
      },
      {
        id: 'authorize',
        receiver: 'ScheduleCheck',
        name: 'authorize',
        args: 'session, name, check',
        file: 'check.ts',
        line: 117,
        status: 'new',
        children: [
          {
            id: 'authorizeCode',
            name: 'authorizeCode',
            args: '...',
            file: 'check.ts',
            line: 182,
            status: 'new',
            children: [
              { id: 'resolve', name: 'resolveCodeTools', args: 'paths', file: 'check.ts', line: 160, status: 'new' },
              { id: 'assert', receiver: 'permission', name: 'assert', args: '{ action, metadata }', file: 'check.ts', line: 232, status: 'changed' },
            ],
          },
        ],
      },
      { id: 'evaluate', receiver: 'ScheduleCheck', name: 'evaluate', args: 'session, check, null, ctx', file: 'check.ts', line: 133, status: 'new' },
    ],
  },
  {
    id: 'fire',
    name: 'fire',
    args: 'row, session, due, now',
    file: 'schedule.ts',
    line: 282,
    status: 'existing',
    children: [
      {
        id: 'evaluate-2',
        receiver: 'ScheduleCheck',
        name: 'evaluate',
        args: 'session, check, state, ctx',
        file: 'check.ts',
        line: 133,
        status: 'new',
        children: [
          {
            id: 'runCode',
            name: 'runCode',
            args: '...',
            file: 'check.ts',
            line: 244,
            status: 'new',
            children: [
              {
                id: 'tools-check',
                receiver: 'tools',
                name: 'check',
                args: '{ code, tools: paths, bindings }',
                file: 'tool.ts',
                line: 337,
                status: 'new',
                children: [
                  {
                    id: 'tool-check',
                    receiver: 'CodeModeTool',
                    name: 'check',
                    args: 'inventory, code, bindings',
                    file: 'tool.ts',
                    line: 248,
                    status: 'new',
                    children: [
                      { id: 'execute', receiver: 'CodeMode', name: 'make(...).execute', args: 'code, scope', file: 'codemode.ts', line: 184, status: 'new' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

const countFrames = (frames: readonly CallFrame[]): number => frames.reduce((sum, frame) => sum + 1 + countFrames(frame.children ?? []), 0)
const totalFrames = countFrames(callRoots)

/** The first `limit` frames in depth-first order, as a pruned tree. */
function takeFrames(frames: readonly CallFrame[], budget: { left: number }): CallFrame[] {
  const out: CallFrame[] = []
  for (const frame of frames) {
    if (budget.left <= 0) break
    budget.left--
    const children = takeFrames(frame.children ?? [], budget)
    const { children: _children, ...rest } = frame
    out.push(children.length > 0 ? { ...rest, children } : rest)
  }
  return out
}

function CallStackTreeDemo() {
  const [shown, setShown] = React.useState(1)
  React.useEffect(() => {
    const delay = shown >= totalFrames + 12 ? 0 : 320
    const timer = setTimeout(() => setShown(value => (value >= totalFrames + 12 ? 1 : value + 1)), delay)
    return () => clearTimeout(timer)
  }, [shown])
  const roots = takeFrames(callRoots, { left: Math.min(shown, totalFrames) })
  return <CallStackTree reference="#60140" heading="Create and tick call path" roots={roots} />
}

// ── RevisionAvatarGraph ───────────────────────────────────────────────────────

const people = {
  ada: { name: 'Ada Park' },
  sam: { name: 'Sam Rivera' },
  lena: { name: 'Lena Okafor' },
  luna: { name: 'luna agent', initials: 'LU' },
} as const

function avatarEntries(expanded: boolean): readonly AvatarGraphEntry[] {
  const folded: AvatarGraphEntry[] = expanded
    ? [
        {
          id: 'a1',
          message: 'fix(web): restore focus after dialog close',
          hash: '41ce07a2',
          age: '1d',
          author: people.luna,
          lane: 0,
          parents: ['a2'],
          tone: 'info',
        },
        { id: 'a2', message: 'test(web): cover setup steps layout', hash: '0b9f3e11', age: '2d', author: people.ada, lane: 0, parents: ['a3'], tone: 'info' },
        {
          id: 'a3',
          message: 'feat(web): no-computer setup steps layout pass',
          hash: '7d21aa90',
          age: '3d',
          author: people.luna,
          lane: 0,
          parents: ['b'],
          tone: 'info',
        },
      ]
    : [{ kind: 'gap', id: 'g1', count: 9, lane: 0, label: 'Revisions' }]
  return [
    {
      id: 'a',
      message: 'revert(web): undo the no-computer setup steps layout pass',
      hash: 'ab69b2fd',
      age: '8m',
      author: people.ada,
      lane: 0,
      parents: [expanded ? 'a1' : 'b'],
      tone: 'info',
      bookmark: { name: 'main', current: true },
    },
    ...folded,
    { id: 'b', message: 'chore: sync with upstream main', hash: 'd88d1f8d', age: '4d', author: people.sam, lane: 0, parents: ['d', 'c'], tone: 'info' },
    {
      id: 'c',
      message: "fix(web): pinned threads' pin icon stays put on hover",
      hash: '67c0fc0c',
      age: '4d',
      author: people.lena,
      lane: 1,
      parents: ['f'],
      tone: 'violet',
      note: 'Merged history',
    },
    { id: 'd', message: 'rebrand clients and assets', hash: '8b7be038', age: '6d', author: people.ada, lane: 0, parents: ['e'], tone: 'info' },
    { id: 'e', message: 'chore: sync with upstream main', hash: '8538c480', age: '6d', author: people.sam, lane: 0, parents: ['h', 'f'], tone: 'info' },
    {
      id: 'f',
      message: "feat(web): choose the in-app browser's search engine",
      hash: '1451e7cb',
      age: '6d',
      author: people.lena,
      lane: 1,
      parents: ['h'],
      tone: 'violet',
    },
    { kind: 'gap', id: 'g2', count: 62, lane: 0, label: 'Revisions' },
    {
      id: 'h',
      message: "Merge 'feat/project-visualization' into main",
      hash: '78213874',
      age: '6d',
      author: people.ada,
      lane: 0,
      parents: ['k', 'i'],
      tone: 'info',
    },
    {
      id: 'i',
      message: 'chore: merge project graph runtime compatibility',
      hash: 'd3416afe',
      age: '17d',
      author: people.luna,
      lane: 1,
      parents: ['j'],
      tone: 'teal',
      note: 'Merged history',
    },
    {
      id: 'j',
      message: 'fix(web): adapt project graph to thread runtime',
      hash: 'de9a854a',
      age: '17d',
      author: people.luna,
      lane: 1,
      parents: ['k'],
      tone: 'teal',
      note: 'Merged history',
    },
    { id: 'k', message: 'chore: sync project visualization with main', hash: 'b2e695b0', age: '17d', author: people.sam, lane: 0, parents: [], tone: 'info' },
  ]
}

function RevisionAvatarGraphDemo() {
  const [expanded, setExpanded] = React.useState(false)
  const [selected, setSelected] = React.useState<string | undefined>(undefined)
  React.useEffect(() => {
    const timer = setTimeout(() => setExpanded(value => !value), expanded ? 4200 : 2600)
    return () => clearTimeout(timer)
  }, [expanded])
  return (
    <RevisionAvatarGraph
      entries={avatarEntries(expanded)}
      onExpandGap={id => (id === 'g1' ? setExpanded(true) : undefined)}
      {...(selected === undefined ? {} : { selectedId: selected })}
      onSelectRevision={setSelected}
    />
  )
}

export const revisionsDemos: readonly GalleryDemo[] = [
  {
    id: 'revisions-scrubber',
    title: 'RevisionScrubber',
    description: "Wheel-style scrubber over a thread's jj revisions or a backlog history: drag or arrow through it while the cards glide and the label rolls.",
    source: "import { RevisionScrubber } from '@dshfiles/plugin-ui/components/motion/revision-scrubber'",
    wide: true,
    render: () => <RevisionScrubberDemo />,
  },
  {
    id: 'revisions-merge-conflict-graph',
    title: 'MergeConflictGraph',
    description: 'A thread workspace about to land: main moved, conflicting revisions light up, and the merge revision slides in while hunks resolve.',
    source: "import { MergeConflictGraph } from '@dshfiles/plugin-ui/components/motion/merge-conflict-graph'",
    wide: true,
    render: () => <MergeConflictGraphDemo />,
  },
  {
    id: 'revisions-merge-checks',
    title: 'MergeChecks',
    description: "Checks before a thread's work lands on main: chips flip as tests, lint and types pass, then Merge pops in and sweeps to merged.",
    source: "import { MergeChecks } from '@dshfiles/plugin-ui/components/motion/merge-checks'",
    wide: true,
    render: () => <MergeChecksDemo />,
  },
  {
    id: 'revisions-pipeline-dag',
    title: 'PipelineDag',
    description: 'A landing or project-check pipeline drawn as a table with a DAG gutter, live states, progress and a rescaling span timeline.',
    source: "import { PipelineDag } from '@dshfiles/plugin-ui/components/motion/pipeline-dag'",
    wide: true,
    render: () => <PipelineDagDemo />,
  },
  {
    id: 'revisions-call-stack-tree',
    title: 'CallStackTree',
    description: 'The call path a revision adds or changes, cascading in as the agent maps it; squares mark new, changed and existing frames.',
    source: "import { CallStackTree } from '@dshfiles/plugin-ui/components/motion/call-stack-tree'",
    wide: true,
    render: () => <CallStackTreeDemo />,
  },
  {
    id: 'revisions-avatar-graph',
    title: 'RevisionAvatarGraph',
    description: 'A jj log where every node is its author (you, a teammate or a subagent), with bookmarks on the left and folded runs that unfold in place.',
    source: "import { RevisionAvatarGraph } from '@dshfiles/plugin-ui/components/motion/revision-avatar-graph'",
    wide: true,
    render: () => <RevisionAvatarGraphDemo />,
  },
]
