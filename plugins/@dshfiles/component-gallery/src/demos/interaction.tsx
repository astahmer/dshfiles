import * as React from 'react'
import { AgentRunStatus, type AgentRunState, type AgentRunStep } from '@dshfiles/plugin-ui/components/motion/agent-run-status'
import { ApprovalRun, type ApprovalDecision, type ApprovalRunState, type ApprovalRunStep } from '@dshfiles/plugin-ui/components/motion/approval-run'
import { BulkSelectList, type BulkSelectItem } from '@dshfiles/plugin-ui/components/motion/bulk-select-list'
import { ClarifyPrompt, type ClarifyQuestion, type ClarifySegment } from '@dshfiles/plugin-ui/components/motion/clarify-prompt'
import { ToolbarWalkthrough, type WalkthroughStep, type WalkthroughTool } from '@dshfiles/plugin-ui/components/motion/toolbar-walkthrough'
import {
  BotIcon,
  CropIcon,
  FileSearchIcon,
  FileTextIcon,
  GitBranchIcon,
  HeartIcon,
  InboxIcon,
  MessageCircleIcon,
  MoonIcon,
  ShapesIcon,
  TerminalIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import type { GalleryDemo } from './types.js'

/** Runs `steps` (delay ms, action) in order and loops while mounted; `stop` ends autoplay for good. */
function useScript(steps: readonly (readonly [number, () => void])[], enabled: boolean) {
  const ref = React.useRef(steps)
  ref.current = steps
  React.useEffect(() => {
    if (!enabled) return
    let index = 0
    let timer: ReturnType<typeof setTimeout>
    const next = () => {
      const entry = ref.current[index % ref.current.length]
      if (entry === undefined) return
      timer = setTimeout(() => {
        entry[1]()
        index++
        next()
      }, entry[0])
    }
    next()
    return () => clearTimeout(timer)
  }, [enabled])
}

// ---------------------------------------------------------------------------------------------------------------
// Bulk select

const files: readonly BulkSelectItem[] = [
  { id: 'a', title: 'token-store.ts', meta: '2.4 KB · Edited by @luna', tag: 'TS', tone: 'info' },
  { id: 'b', title: 'Release notes 0.2.1.md', meta: 'Edited by you · 2h ago', tag: 'MD', tone: 'violet' },
  { id: 'c', title: 'trace-export.json', meta: '5.1 MB · Subagent output', tag: 'JSON', tone: 'warning' },
  { id: 'd', title: 'probe-profile.log', meta: '86 KB · Yesterday', tag: 'LOG', tone: 'success' },
  { id: 'e', title: 'screenshot-480.png', meta: '312 KB · verify-dsh', tag: 'PNG', tone: 'destructive' },
]

function BulkSelectDemo() {
  const [items, setItems] = React.useState(files)
  const [selected, setSelected] = React.useState<readonly string[]>([])
  const [staged, setStaged] = React.useState<readonly string[] | null>(null)
  const [auto, setAuto] = React.useState(true)
  useScript(
    [
      [900, () => setSelected(['a'])],
      [140, () => setSelected(['a', 'b'])],
      [140, () => setSelected(['a', 'b', 'c'])],
      [900, () => setStaged(['a', 'b', 'c'])],
      [0, () => setSelected([])],
      [2200, () => setStaged(null)],
      [1600, () => setItems(files)],
    ],
    auto,
  )
  return (
    <div className="dshx:mx-auto dshx:w-full dshx:max-w-md" onPointerDownCapture={() => setAuto(false)} onKeyDownCapture={() => setAuto(false)}>
      <BulkSelectList
        heading="Recent files"
        noun="files"
        items={items}
        selectedIds={selected}
        onSelectionChange={setSelected}
        staged={staged === null ? null : { ids: staged }}
        onDelete={ids => {
          setStaged(ids)
          setSelected([])
        }}
        onUndo={() => setStaged(null)}
        onConfirm={() => {
          setItems(list => list.filter(item => !staged?.includes(item.id)))
          setStaged(null)
        }}
        headerAction={<span>View all</span>}
      />
      <p className="dshx:mt-2 dshx:text-center dshx:text-xs dshx:text-muted-foreground">Press a row and drag across others to select.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Agent run status

const runPlan: readonly Omit<AgentRunStep, 'startedAt'>[] = [
  { id: 'read', label: 'Reading 12 files', icon: FileSearchIcon },
  { id: 'plan', label: 'Planning the change', icon: BotIcon },
  { id: 'edit', label: 'Editing token-store.ts', icon: FileTextIcon },
  { id: 'test', label: 'Running focused tests', icon: TerminalIcon },
  { id: 'jj', label: 'Describing the revision', icon: GitBranchIcon },
  { id: 'sum', label: 'Writing the summary', icon: BotIcon },
]

function AgentRunStatusDemo() {
  const [startedAt, setStartedAt] = React.useState(() => Date.now())
  const [steps, setSteps] = React.useState<readonly AgentRunStep[]>(() => [{ ...runPlan[0]!, startedAt: Date.now() }])
  const [state, setState] = React.useState<AgentRunState>('running')
  const [endedAt, setEndedAt] = React.useState<number | undefined>(undefined)
  const pausedAt = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (state === 'running') {
      const timer = setTimeout(() => {
        const now = Date.now()
        if (steps.length >= runPlan.length) {
          setSteps(list => list.map((s, i) => (i === list.length - 1 ? { ...s, endedAt: now } : s)))
          setEndedAt(now)
          setState('done')
          return
        }
        setSteps(list => [...list.map((s, i) => (i === list.length - 1 ? { ...s, endedAt: now } : s)), { ...runPlan[list.length]!, startedAt: now }])
      }, 1700)
      return () => clearTimeout(timer)
    }
    if (state === 'done' || state === 'stopped') {
      const timer = setTimeout(() => {
        const now = Date.now()
        setStartedAt(now)
        setEndedAt(undefined)
        setSteps([{ ...runPlan[0]!, startedAt: now }])
        setState('running')
      }, 2600)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [state, steps.length])

  const togglePause = () => {
    if (state === 'running') {
      pausedAt.current = Date.now()
      setState('paused')
      return
    }
    // Resuming: shift the clocks by the paused span so they continue where they froze.
    const gap = Date.now() - (pausedAt.current ?? Date.now())
    setStartedAt(value => value + gap)
    setSteps(list => list.map((s, i) => (i === list.length - 1 ? { ...s, startedAt: s.startedAt + gap } : s)))
    setState('running')
  }

  return (
    <div className="dshx:mx-auto dshx:w-full dshx:max-w-md">
      <AgentRunStatus
        heading="Fix the flaky token-store test"
        model="DeepSeek V4 · @luna"
        steps={steps}
        totalSteps={runPlan.length}
        startedAt={startedAt}
        {...(endedAt === undefined ? {} : { endedAt })}
        state={state}
        onPauseToggle={togglePause}
        onStop={() => {
          setEndedAt(Date.now())
          setState('stopped')
        }}
        onOpen={() => undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Approval run

const approvalPlan: readonly ApprovalRunStep[] = [
  { id: 's1', label: 'Traced the failing event', detail: 'charge.refunded', status: 'pending', durationSeconds: 8 },
  {
    id: 's2',
    label: '41 events queued',
    detail: 'events',
    badge: { label: 'Check', tone: 'warning' },
    note: '39 still pending, 2 already past the retry window',
    status: 'pending',
    durationSeconds: 3,
  },
  { id: 's3', label: 'Read 4 pages', detail: 'docs/webhooks.md', status: 'pending', durationSeconds: 6 },
  { id: 's4', label: 'Running the failing case', detail: 'webhook.test.ts', status: 'pending', durationSeconds: 11 },
  {
    id: 's5',
    label: 'Needs your answer',
    detail: 'src/api/webhook.ts',
    gate: 'answer',
    badge: { label: 'Stops for you', tone: 'success' },
    question: 'Retry the 2 events past the window, or drop them?',
    status: 'pending',
    durationSeconds: 4,
  },
  { id: 's6', label: 'Editing the refund branch', detail: 'src/api/webhook.ts', status: 'pending', durationSeconds: 9 },
  {
    id: 's7',
    label: 'Needs your approval',
    tool: 'fly',
    detail: 'webhook-consumer',
    gate: 'approval',
    badge: { label: 'High impact', tone: 'destructive' },
    question: 'Scale webhook-consumer from 2 to 4 machines in production.',
    status: 'pending',
    durationSeconds: 5,
  },
  { id: 's8', label: 'scale_app', tool: 'fly', detail: 'webhook-consumer', status: 'pending', durationSeconds: 7 },
]

function approvalRunState(finished: boolean, paused: boolean, waiting: boolean): ApprovalRunState {
  if (finished) return 'done'
  if (paused) return 'paused'
  if (waiting) return 'waiting'
  return 'working'
}

function ApprovalRunDemo() {
  const [cursor, setCursor] = React.useState(3)
  const [progress, setProgress] = React.useState(0.1)
  const [paused, setPaused] = React.useState(false)
  const [denied, setDenied] = React.useState<readonly string[]>([])
  const [startedAt, setStartedAt] = React.useState(() => Date.now() - 17_000)
  const [endedAt, setEndedAt] = React.useState<number | undefined>(undefined)
  const active = approvalPlan[cursor]
  const waiting = active?.gate !== undefined
  const finished = cursor >= approvalPlan.length

  const advance = React.useCallback(() => {
    setCursor(c => c + 1)
    setProgress(0.08)
  }, [])

  React.useEffect(() => {
    if (paused) return undefined
    if (finished) {
      if (endedAt === undefined) setEndedAt(Date.now())
      const timer = setTimeout(() => {
        setCursor(3)
        setProgress(0.1)
        setDenied([])
        setStartedAt(Date.now() - 17_000)
        setEndedAt(undefined)
      }, 3000)
      return () => clearTimeout(timer)
    }
    if (waiting) {
      // Nobody answered: the demo approves on its own so the loop keeps playing.
      const timer = setTimeout(advance, 5200)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => {
      if (progress >= 1) advance()
      else setProgress(p => Math.min(1, p + 0.14 + Math.random() * 0.12))
    }, 420)
    return () => clearTimeout(timer)
  }, [paused, finished, waiting, progress, advance, endedAt])

  const steps: ApprovalRunStep[] = approvalPlan.map((step, index) => {
    if (index < cursor) {
      const done: ApprovalRunStep = { ...step, status: 'done' }
      if (denied.includes(step.id)) return { ...done, note: 'Denied, skipped' }
      return done
    }
    if (index === cursor) return step.gate === undefined ? { ...step, status: 'running', progress } : { ...step, status: 'waiting' }
    return step
  })
  const visible = steps.slice(0, 8)
  const state = approvalRunState(finished, paused, waiting)

  return (
    <div className="dshx:mx-auto dshx:w-full dshx:max-w-xl">
      <ApprovalRun
        heading="Reproduce webhook failure"
        state={state}
        steps={visible}
        moreCount={1}
        totalSteps={9}
        startedAt={startedAt}
        {...(endedAt === undefined ? {} : { endedAt })}
        onPauseToggle={() => setPaused(p => !p)}
        onDecision={(stepId: string, decision: ApprovalDecision) => {
          if (decision === 'deny') setDenied(list => [...list, stepId])
          advance()
        }}
        onMenu={() => undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Clarify prompt

function PanelMock({ side }: { readonly side: 'left' | 'right' | 'bottom' }) {
  const hatch = {
    backgroundImage:
      'repeating-linear-gradient(135deg, color-mix(in oklab, var(--dsw-alias-state-business-primary) 35%, transparent) 0 1px, transparent 1px 6px)',
  }
  const panel = (
    <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-md dshx:bg-card dshx:p-1.5 dshx:shadow-sm">
      <div className="dshx:h-1.5 dshx:w-10 dshx:rounded-full dshx:bg-muted-foreground/40" />
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="dshx:flex dshx:items-center dshx:gap-1">
          <div className="dshx:size-2 dshx:rounded-sm dshx:bg-muted" />
          <div className="dshx:h-1.5 dshx:flex-1 dshx:rounded-full dshx:bg-muted" />
        </div>
      ))}
      <div className="dshx:mt-1 dshx:h-1.5 dshx:w-8 dshx:rounded-full dshx:bg-muted-foreground/30" />
      <div className="dshx:h-1 dshx:rounded-full dshx:bg-muted" />
      <div className="dshx:h-1 dshx:w-2/3 dshx:rounded-full dshx:bg-muted" />
    </div>
  )
  if (side === 'bottom') {
    return (
      <div className="dshx:flex dshx:h-36 dshx:w-56 dshx:max-w-full dshx:flex-col dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-1.5">
        <div className="dshx:flex-1 dshx:rounded-md dshx:bg-muted/60" />
        <div className="dshx:rounded-md dshx:border dshx:border-info/50 dshx:p-2" style={hatch}>
          <div className="dshx:h-6 dshx:rounded-md dshx:bg-card" />
        </div>
      </div>
    )
  }
  return (
    <div className="dshx:flex dshx:h-36 dshx:w-56 dshx:max-w-full dshx:gap-1.5 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-background dshx:p-1.5">
      {side === 'left' ? (
        <div className="dshx:w-20 dshx:shrink-0 dshx:rounded-md dshx:border dshx:border-info/50 dshx:p-2" style={hatch}>
          {panel}
        </div>
      ) : null}
      <div className="dshx:flex-1 dshx:rounded-md dshx:bg-muted/60" />
      {side === 'right' ? (
        <div className="dshx:w-20 dshx:shrink-0 dshx:rounded-md dshx:border dshx:border-info/50 dshx:p-2" style={hatch}>
          {panel}
        </div>
      ) : null}
    </div>
  )
}

const questions: readonly (ClarifyQuestion & { readonly values: readonly string[]; readonly token: string })[] = [
  {
    id: 'panel',
    lead: 'Are you talking about the',
    candidates: [
      { id: 'right', label: 'Right panel', preview: <PanelMock side="right" /> },
      { id: 'left', label: 'Thread sidebar', preview: <PanelMock side="left" /> },
      { id: 'composer', label: 'Composer dock', preview: <PanelMock side="bottom" /> },
    ],
    values: ['24', '24', '24', '24'],
    token: 'space/xl',
  },
  {
    id: 'sides',
    lead: 'Should the padding apply to',
    candidates: [
      { id: 'all', label: 'all four sides', preview: <PanelMock side="right" /> },
      { id: 'x', label: 'left and right only', preview: <PanelMock side="right" /> },
    ],
    values: ['24', '0', '24', '0'],
    token: 'space/xl',
  },
  {
    id: 'mobile',
    lead: 'Keep it on phones too, or use',
    trail: ' there?',
    candidates: [{ id: 'md', label: '16px', preview: <PanelMock side="bottom" /> }],
    values: ['16', '16', '16', '16'],
    token: 'space/md',
  },
  {
    id: 'scope',
    lead: 'Apply it to',
    candidates: [
      { id: 'this', label: 'this surface only', preview: <PanelMock side="right" /> },
      { id: 'all', label: 'every side panel', preview: <PanelMock side="left" /> },
    ],
    values: ['24', '24', '24', '24'],
    token: 'space/xl',
  },
]

function ClarifyPromptDemo() {
  const [index, setIndex] = React.useState(0)
  const [candidate, setCandidate] = React.useState(0)
  const [auto, setAuto] = React.useState(true)
  const question = questions[index % questions.length]!
  useScript(
    [
      [2000, () => setCandidate(c => c + 1)],
      [2000, () => setCandidate(c => c - 1)],
      [
        1800,
        () => {
          setIndex(i => (i + 1) % questions.length)
          setCandidate(0)
        },
      ],
    ],
    auto,
  )
  const target = question.candidates[((candidate % question.candidates.length) + question.candidates.length) % question.candidates.length]
  const prompt: ClarifySegment[] = [
    { text: 'make the ' },
    { id: 'target', text: index === 0 ? (target?.label.toLowerCase() ?? 'side panel') : 'side panel', tone: 'target' },
    { text: ' have ' },
    { id: 'value', text: `${question.values[0] ?? '24'}px padding`, tone: 'value' },
  ]
  return (
    <div className="dshx:mx-auto dshx:w-full dshx:max-w-lg" onPointerDownCapture={() => setAuto(false)}>
      <ClarifyPrompt
        question={question}
        index={index % questions.length}
        total={questions.length}
        candidateIndex={candidate}
        onCandidateChange={setCandidate}
        onAnswer={() => {
          setIndex(i => (i + 1) % questions.length)
          setCandidate(0)
        }}
        values={question.values}
        token={question.token}
        prompt={prompt}
        onSubmit={() => undefined}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Toolbar walkthrough

const tools: readonly WalkthroughTool[] = [
  { id: 'comment', label: 'Comment', icon: MessageCircleIcon },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'capture', label: 'Capture', icon: CropIcon },
  { id: 'activity', label: 'Activity', icon: HeartIcon },
  { id: 'widgets', label: 'Widgets', icon: ShapesIcon },
  { id: 'theme', label: 'Theme', icon: MoonIcon, separatorBefore: true },
  { id: 'close', label: 'Close toolbar', icon: XIcon },
]

function MiniStat({ label, value, accent }: { readonly label: string; readonly value: string; readonly accent?: boolean }) {
  return (
    <div className="dshx:flex dshx:w-48 dshx:flex-col dshx:gap-2 dshx:p-3">
      <span className="dshx:text-[10px] dshx:text-muted-foreground">{label}</span>
      <span className="dshx:text-lg dshx:font-medium dshx:tabular-nums">{value}</span>
      <div className="dshx:flex dshx:h-2 dshx:gap-0.5 dshx:overflow-hidden dshx:rounded-full">
        <div className="dshx:flex-[4] dshx:bg-muted-foreground/50" />
        <div className="dshx:flex-[1] dshx:bg-muted-foreground/40" />
        <div className="dshx:flex-[2] dshx:bg-muted-foreground/30" />
        <div className={accent ? 'dshx:flex-[1] dshx:bg-primary' : 'dshx:flex-[1] dshx:bg-muted-foreground/20'} />
      </div>
    </div>
  )
}

const tourSteps: readonly WalkthroughStep[] = [
  {
    toolId: 'comment',
    title: 'Add a comment',
    body: 'Click anywhere in a thread to pin a note to that exact spot. The agent reads it on its next turn.',
    preview: <MiniStat label="Tokens this thread" value="138k" />,
  },
  {
    toolId: 'inbox',
    title: 'Your inbox',
    body: 'Questions from subagents and finished turns you have not read land here.',
    preview: <MiniStat label="Waiting for you" value="3" accent />,
  },
  {
    toolId: 'capture',
    title: 'Capture what you see',
    body: 'Screenshot part of the page and attach it, so the agent sees exactly what you mean.',
    preview: <MiniStat label="Cost today" value="$4.12" />,
  },
  {
    toolId: 'activity',
    title: 'Keep up with your agents',
    body: 'Mentions, replies and landed revisions show up here, so nothing slips by.',
    preview: <MiniStat label="Revisions landed" value="12" accent />,
  },
  {
    toolId: 'widgets',
    title: 'Add widgets',
    body: 'Pin a trace waterfall, a cost meter or the merge queue next to the thread.',
    preview: <MiniStat label="Open traces" value="7" />,
  },
]

function ToolbarWalkthroughDemo() {
  const [step, setStep] = React.useState<number | null>(0)
  const [auto, setAuto] = React.useState(true)
  React.useEffect(() => {
    if (!auto) {
      if (step !== null) return undefined
      const timer = setTimeout(() => setStep(0), 1600)
      return () => clearTimeout(timer)
    }
    const timer = setTimeout(() => setStep(s => (s === null ? 0 : s >= tourSteps.length - 1 ? null : s + 1)), step === null ? 1400 : 2600)
    return () => clearTimeout(timer)
  }, [auto, step])
  return (
    <div className="dshx:flex dshx:min-h-[420px] dshx:items-end dshx:justify-center" onPointerDownCapture={() => setAuto(false)}>
      <ToolbarWalkthrough className="dshx:max-w-[34rem]" tools={tools} steps={tourSteps} step={step} onStepChange={setStep} onClose={() => setStep(null)} />
    </div>
  )
}

export const interactionDemos: readonly GalleryDemo[] = [
  {
    id: 'interaction-bulk-select-list',
    title: 'BulkSelectList',
    description: 'Drag-select rows and bulk-delete with an undoable stacked toast: discarding thread workspaces, backlog items or stale traces.',
    source: "import { BulkSelectList } from '@dshfiles/plugin-ui/components/motion/bulk-select-list'",
    render: () => <BulkSelectDemo />,
  },
  {
    id: 'interaction-agent-run-status',
    title: 'AgentRunStatus',
    description: 'Compact live card for one agent or subagent run: current step, clock, step rail and Pause / Stop / Open run.',
    source: "import { AgentRunStatus } from '@dshfiles/plugin-ui/components/motion/agent-run-status'",
    render: () => <AgentRunStatusDemo />,
  },
  {
    id: 'interaction-approval-run',
    title: 'ApprovalRun',
    description: 'A thread run that stops before high-impact tool calls and waits for approve, revise or deny.',
    source: "import { ApprovalRun } from '@dshfiles/plugin-ui/components/motion/approval-run'",
    wide: true,
    render: () => <ApprovalRunDemo />,
  },
  {
    id: 'interaction-clarify-prompt',
    title: 'ClarifyPrompt',
    description: 'The agent confirms what you meant before it acts: a yes/no question with candidate previews above the composer.',
    source: "import { ClarifyPrompt } from '@dshfiles/plugin-ui/components/motion/clarify-prompt'",
    wide: true,
    render: () => <ClarifyPromptDemo />,
  },
  {
    id: 'interaction-toolbar-walkthrough',
    title: 'ToolbarWalkthrough',
    description: 'A guided tour over a floating toolbar for onboarding new DSH surfaces; the coach card glides from tool to tool.',
    source: "import { ToolbarWalkthrough } from '@dshfiles/plugin-ui/components/motion/toolbar-walkthrough'",
    wide: true,
    render: () => <ToolbarWalkthroughDemo />,
  },
]
