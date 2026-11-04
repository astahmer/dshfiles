import * as React from 'react'
import {
  BotIcon,
  BrainIcon,
  CreditCardIcon,
  FileTextIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GlobeIcon,
  LinkIcon,
  PenLineIcon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
  ZapIcon,
} from '@dshfiles/plugin-ui/icons'
import {
  AgentTimeline,
  type AgentTimelineHandoff,
  type AgentTimelineLane,
  type AgentTimelineSegment,
} from '@dshfiles/plugin-ui/components/motion/agent-timeline'
import { TraceWaterfall, type TraceSpan } from '@dshfiles/plugin-ui/components/motion/trace-waterfall'
import { TraceReplay, type ReplayStep } from '@dshfiles/plugin-ui/components/motion/trace-replay'
import { CostWaterfall, type CostStep } from '@dshfiles/plugin-ui/components/motion/cost-waterfall'
import { FallbackChain, type FallbackAttempt } from '@dshfiles/plugin-ui/components/motion/fallback-chain'
import type { GalleryDemo } from './types.js'

/* ------------------------------------------------------------ a scripted clock */

/** Seconds since the script started, looping after `total` plus a hold. The demo owns the fake data; components stay controlled. */
function useScriptClock(total: number, holdSeconds = 4) {
  const [startedAt, setStartedAt] = React.useState(() => Date.now())
  const [t, setT] = React.useState(0)
  React.useEffect(() => {
    const id = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000
      if (elapsed > total + holdSeconds) {
        setStartedAt(Date.now())
        setT(0)
      } else setT(Math.min(elapsed, total))
    }, 120)
    return () => window.clearInterval(id)
  }, [startedAt, total, holdSeconds])
  return { startedAt, t, live: t < total }
}

/* ------------------------------------------------------------ AgentTimeline */

const lanes: readonly AgentTimelineLane[] = [
  { id: 'orch', name: 'Orchestrator', model: 'deepseek-v4-pro', glyph: { icon: SparklesIcon }, tone: 'neutral' },
  { id: 'check', name: 'Checker', model: 'gpt-6-luna', glyph: { icon: BrainIcon }, tone: 'info' },
  { id: 'research', name: 'Researcher', model: 'deepseek-v4-pro', glyph: { icon: SparklesIcon }, tone: 'violet' },
  { id: 'analyst', name: 'Analyst', model: 'deepseek-v4-flash', glyph: { icon: ZapIcon }, tone: 'warning' },
  { id: 'writer', name: 'Writer', model: 'gemini-flash', glyph: { icon: BrainIcon }, tone: 'success' },
]

const seg = (laneId: string, kind: AgentTimelineSegment['kind'], start: number, end: number): AgentTimelineSegment => {
  const tokens = kind === 'waiting' ? 0 : Math.round((end - start) * 1100)
  return { id: `${laneId}-${start}`, laneId, kind, start, end, tokens, cost: tokens * 0.0000026 }
}

const timelineSegments: readonly AgentTimelineSegment[] = [
  seg('orch', 'thinking', 0, 2),
  seg('orch', 'waiting', 2.1, 18.9),
  seg('orch', 'tool', 19, 20.2),
  seg('orch', 'thinking', 23.6, 26),
  seg('analyst', 'thinking', 2.6, 3.4),
  seg('analyst', 'failed', 3.5, 5.6),
  seg('analyst', 'thinking', 5.8, 6.6),
  seg('analyst', 'retry', 6.7, 8.4),
  seg('analyst', 'tool', 8.6, 11),
  seg('analyst', 'thinking', 11.2, 12.2),
  seg('research', 'thinking', 3.1, 3.9),
  seg('research', 'tool', 4, 5.4),
  seg('research', 'thinking', 5.6, 6.2),
  seg('research', 'tool', 6.3, 9.2),
  seg('research', 'thinking', 9.4, 10),
  seg('research', 'tool', 10.1, 14.5),
  seg('check', 'thinking', 3.7, 4.4),
  seg('check', 'tool', 4.5, 5.9),
  seg('check', 'thinking', 6, 6.7),
  seg('check', 'tool', 6.8, 8.3),
  seg('check', 'thinking', 8.5, 9),
  seg('check', 'tool', 9.1, 16.8),
  seg('writer', 'thinking', 20, 20.8),
  seg('writer', 'tool', 21, 23.2),
]

const timelineHandoffs: readonly AgentTimelineHandoff[] = [
  { id: 'h1', fromLaneId: 'orch', toLaneId: 'analyst', at: 2.1 },
  { id: 'h2', fromLaneId: 'orch', toLaneId: 'research', at: 2.6 },
  { id: 'h3', fromLaneId: 'orch', toLaneId: 'check', at: 3.2 },
  { id: 'h4', fromLaneId: 'orch', toLaneId: 'writer', at: 19.6 },
]

function AgentTimelineDemo() {
  return <AgentTimeline heading="Checkout conversion drop on Oct 14" lanes={lanes} segments={timelineSegments} handoffs={timelineHandoffs} duration={26} />
}

/* ------------------------------------------------------------ TraceWaterfall (live) */

const waterfallScript: readonly TraceSpan[] = [
  { id: 'orch', name: 'Orchestrator', detail: 'deepseek-v4-pro', kind: 'agent', glyph: { icon: SparklesIcon, tone: 'warning' }, start: 0, end: 20 },
  {
    id: 'plan',
    parentId: 'orch',
    name: 'Plan the launch',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: SparklesIcon, tone: 'warning' },
    start: 0.3,
    end: 3,
    cost: 0.1,
    tokens: 4000,
  },
  {
    id: 'research',
    parentId: 'orch',
    name: 'Researcher',
    detail: 'deepseek-v4-flash',
    kind: 'agent',
    glyph: { icon: BotIcon, tone: 'violet' },
    start: 3.1,
    end: 12,
  },
  { id: 'r1', parentId: 'research', name: 'web_search', detail: 'pricing pages', kind: 'tool', glyph: { icon: GlobeIcon, tone: 'teal' }, start: 3.3, end: 5 },
  {
    id: 'r2',
    parentId: 'research',
    name: 'Summarize findings',
    detail: 'deepseek-v4-flash',
    kind: 'model',
    glyph: { icon: SparklesIcon, tone: 'violet' },
    start: 5.1,
    end: 9.5,
    cost: 0.03,
    tokens: 12_400,
  },
  { id: 'r3', parentId: 'research', name: 'Save research', detail: 'notes.md', kind: 'tool', glyph: { icon: SaveIcon, tone: 'teal' }, start: 9.6, end: 11.8 },
  { id: 'writer', parentId: 'orch', name: 'Writer', detail: 'deepseek-v4-pro', kind: 'agent', glyph: { icon: BotIcon, tone: 'info' }, start: 4, end: 15 },
  {
    id: 'w1',
    parentId: 'writer',
    name: 'Read brand voice',
    detail: 'docs/voice.md',
    kind: 'tool',
    glyph: { icon: FileTextIcon, tone: 'teal' },
    start: 4.2,
    end: 5.6,
  },
  {
    id: 'w2',
    parentId: 'writer',
    name: 'Read pricing frames',
    detail: 'design/pricing',
    kind: 'tool',
    glyph: { icon: FileTextIcon, tone: 'teal' },
    start: 4.3,
    end: 6.3,
  },
  {
    id: 'w3',
    parentId: 'writer',
    name: 'Draft plan copy',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: PenLineIcon, tone: 'info' },
    start: 6.5,
    end: 13.5,
    cost: 0.09,
    tokens: 22_000,
  },
  { id: 'w4', parentId: 'writer', name: 'Save draft', detail: 'copy.md', kind: 'tool', glyph: { icon: SaveIcon, tone: 'teal' }, start: 13.6, end: 14.9 },
  { id: 'coder', parentId: 'orch', name: 'Coder', detail: 'gpt-6-sol', kind: 'agent', glyph: { icon: BotIcon, tone: 'success' }, start: 6, end: 19.5 },
  { id: 'c1', parentId: 'coder', name: 'Create branch', detail: 'jj new main', kind: 'tool', glyph: { icon: GitBranchIcon, tone: 'teal' }, start: 6.2, end: 7 },
  {
    id: 'c2',
    parentId: 'coder',
    name: 'Write pricing page',
    detail: 'gpt-6-sol',
    kind: 'model',
    glyph: { icon: SparklesIcon, tone: 'success' },
    start: 7.2,
    end: 14,
    cost: 0.16,
    tokens: 31_000,
  },
  {
    id: 'c3',
    parentId: 'coder',
    name: 'Create prices',
    detail: 'billing API',
    kind: 'tool',
    glyph: { icon: CreditCardIcon, tone: 'teal' },
    start: 14.2,
    end: 15.4,
  },
  {
    id: 'c4',
    parentId: 'coder',
    name: 'Run checkout tests',
    detail: 'pnpm test',
    kind: 'tool',
    glyph: { icon: FlaskConicalIcon, tone: 'teal' },
    start: 15.6,
    end: 19,
    error: 'Exit 1: 2 failing',
  },
]

/** The script as seen at `t` seconds: started spans only, open ones without end, cost or error. */
const atTime = <T extends { readonly start: number; readonly end?: number | undefined }>(items: readonly T[], t: number, strip: (item: T) => T): T[] =>
  items.filter(item => item.start <= t).map(item => (item.end !== undefined && item.end > t ? strip(item) : item))

function TraceWaterfallDemo() {
  const { startedAt, t, live } = useScriptClock(20)
  const [selected, setSelected] = React.useState<string | null>(null)
  const spans = React.useMemo(
    () => atTime(waterfallScript, t, span => ({ ...span, end: undefined, cost: undefined, tokens: undefined, error: undefined })),
    [t],
  )
  return (
    <TraceWaterfall
      key={startedAt}
      subtitle="Launch the new pricing page by Friday"
      spans={spans}
      live={live}
      startedAt={startedAt}
      selectedId={selected}
      onSelectSpan={id => setSelected(current => (current === id ? null : id))}
    />
  )
}

/* ------------------------------------------------------------ TraceReplay */

const replaySteps: readonly ReplayStep[] = [
  { id: 'mira', name: 'Mira', detail: 'deepseek-v4-pro', kind: 'agent', tone: 'neutral', glyph: { icon: BotIcon }, start: 0, end: 24 },
  {
    id: 'm1',
    parentId: 'mira',
    name: 'Thinking',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: BrainIcon },
    start: 0,
    end: 2,
    cost: 0.01,
    tokens: 1800,
    input: 'Show subagents in the turn steps',
    output: 'Plan: find where steps render, then delegate',
  },
  {
    id: 'm2',
    parentId: 'mira',
    name: 'read',
    detail: 'turn-steps.ts',
    kind: 'tool',
    glyph: { icon: FileTextIcon },
    start: 2.1,
    end: 2.5,
    input: 'src/turn-steps.ts',
    output: '214 lines',
  },
  {
    id: 'm3',
    parentId: 'mira',
    name: 'search',
    detail: 'itemCreatedAt',
    kind: 'tool',
    glyph: { icon: SearchIcon },
    start: 2.7,
    end: 3.4,
    input: 'itemCreatedAt',
    output: '6 matches in 3 files',
  },
  {
    id: 'm4',
    parentId: 'mira',
    name: 'Thinking',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: BrainIcon },
    start: 3.6,
    end: 5.6,
    cost: 0.01,
    tokens: 2100,
    output: 'Split: explore the UI, review the types',
  },
  { id: 'm5', parentId: 'mira', name: 'Start 2 subagents', kind: 'handoff', glyph: { icon: GitBranchIcon }, start: 5.7, end: 6, output: 'Explore, Review' },
  {
    id: 'explore',
    parentId: 'mira',
    name: 'Explore',
    detail: 'deepseek-v4-flash',
    kind: 'agent',
    tone: 'violet',
    glyph: { icon: BotIcon },
    start: 6.2,
    end: 13.8,
    handoffAt: 6,
  },
  {
    id: 'e1',
    parentId: 'explore',
    name: 'Thinking',
    detail: 'deepseek-v4-flash',
    kind: 'model',
    glyph: { icon: BrainIcon },
    start: 6.2,
    end: 7.3,
    cost: 0.001,
    tokens: 900,
  },
  {
    id: 'e2',
    parentId: 'explore',
    name: 'search',
    detail: 'AgentSteps',
    kind: 'tool',
    glyph: { icon: SearchIcon },
    start: 7.5,
    end: 9,
    input: 'AgentSteps',
    output: '2 components',
  },
  {
    id: 'e3',
    parentId: 'explore',
    name: 'read',
    detail: 'AgentSteps.tsx',
    kind: 'tool',
    glyph: { icon: FileTextIcon },
    start: 9.2,
    end: 9.6,
    input: 'src/AgentSteps.tsx',
    output: '188 lines',
  },
  {
    id: 'e4',
    parentId: 'explore',
    name: 'read',
    detail: 'Subagents.tsx',
    kind: 'tool',
    glyph: { icon: FileTextIcon },
    start: 9.8,
    end: 10.2,
    input: 'src/Subagents.tsx',
    output: '97 lines',
  },
  {
    id: 'e5',
    parentId: 'explore',
    name: 'Summary',
    detail: 'deepseek-v4-flash',
    kind: 'model',
    glyph: { icon: SparklesIcon },
    start: 10.4,
    end: 13.8,
    cost: 0.004,
    tokens: 3100,
    output: 'Steps render in AgentSteps; subagents are flattened',
  },
  {
    id: 'review',
    parentId: 'mira',
    name: 'Review',
    detail: 'deepseek-v4-pro',
    kind: 'agent',
    tone: 'warning',
    glyph: { icon: BotIcon },
    start: 6.4,
    end: 19.5,
    handoffAt: 6,
  },
  {
    id: 'v1',
    parentId: 'review',
    name: 'command',
    detail: 'pnpm typecheck',
    kind: 'tool',
    glyph: { icon: TerminalIcon },
    start: 6.4,
    end: 14,
    input: 'pnpm typecheck',
    output: '3 errors in turn-steps.ts',
  },
  {
    id: 'v2',
    parentId: 'review',
    name: 'Fix types',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: PenLineIcon },
    start: 14.2,
    end: 15.2,
    cost: 0.003,
    tokens: 1200,
    failed: true,
    error: 'Edit anchor not found in turn-steps.ts',
  },
  {
    id: 'v3',
    parentId: 'review',
    name: 'Fix types',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: PenLineIcon },
    start: 15.4,
    end: 19.5,
    cost: 0.008,
    tokens: 4200,
    retry: true,
    output: 'Typecheck passes',
  },
  {
    id: 'm6',
    parentId: 'mira',
    name: 'Summary',
    detail: 'deepseek-v4-pro',
    kind: 'model',
    glyph: { icon: SparklesIcon },
    start: 19.8,
    end: 23.5,
    cost: 0.02,
    tokens: 3600,
    output: 'Subagents now nest under their turn step',
  },
]

function TraceReplayDemo() {
  return <TraceReplay steps={replaySteps} duration={24} />
}

/* ------------------------------------------------------------ CostWaterfall (live) */

const costScript: readonly CostStep[] = [
  {
    id: 'plan',
    name: 'Plan the report',
    detail: 'deepseek-v4-pro',
    glyph: { icon: SparklesIcon, tone: 'warning' },
    start: 0,
    end: 3,
    inputTokens: 4100,
    outputTokens: 960,
    cost: 0.04,
  },
  { id: 'researcher', name: 'Researcher', detail: 'deepseek-v4-flash', glyph: { icon: BotIcon, tone: 'info' }, start: 3.1, end: 11.6 },
  {
    id: 'r1',
    parentId: 'researcher',
    name: 'web_search',
    detail: 'API prices',
    glyph: { icon: SearchIcon, tone: 'teal' },
    start: 3.2,
    end: 5.5,
    input: '{ "query": "LLM API prices 2026" }',
    output: '12 results',
  },
  {
    id: 'r2',
    parentId: 'researcher',
    name: 'Read sources',
    detail: 'deepseek-v4-flash',
    glyph: { icon: SparklesIcon, tone: 'info' },
    start: 5.6,
    end: 9,
    inputTokens: 22_000,
    outputTokens: 800,
    cost: 0.02,
  },
  {
    id: 'r3',
    parentId: 'researcher',
    name: 'Summarize',
    detail: 'deepseek-v4-flash',
    glyph: { icon: SparklesIcon, tone: 'info' },
    start: 9.1,
    end: 11.6,
    inputTokens: 16_400,
    outputTokens: 500,
    cost: 0.01,
  },
  {
    id: 'write',
    name: 'Write the report',
    detail: 'deepseek-v4-pro',
    glyph: { icon: PenLineIcon, tone: 'warning' },
    start: 11.7,
    end: 19.2,
    inputTokens: 21_800,
    outputTokens: 5600,
    cost: 0.25,
  },
  { id: 'reviewer', name: 'Reviewer', detail: 'deepseek-v4-flash', glyph: { icon: BotIcon, tone: 'violet' }, start: 19.3, end: 22.5 },
  {
    id: 'v1',
    parentId: 'reviewer',
    name: 'Check facts',
    detail: 'deepseek-v4-flash',
    glyph: { icon: SparklesIcon, tone: 'violet' },
    start: 19.3,
    end: 21.3,
    inputTokens: 26_000,
    outputTokens: 700,
    cost: 0.03,
  },
  {
    id: 'v2',
    parentId: 'reviewer',
    name: 'check_links',
    detail: '31 links',
    glyph: { icon: LinkIcon, tone: 'teal' },
    start: 21.4,
    end: 22.5,
    error: '2 of 31 links return 404: two pricing pages moved',
    input: '{ "links": 31, "timeout_ms": 5000 }',
  },
  {
    id: 'apply',
    name: 'Apply review',
    detail: 'deepseek-v4-pro',
    glyph: { icon: PenLineIcon, tone: 'warning' },
    start: 22.6,
    end: 25.4,
    inputTokens: 24_500,
    outputTokens: 1900,
    cost: 0.1,
  },
  {
    id: 'save',
    name: 'Save report',
    detail: 'reports/',
    glyph: { icon: SaveIcon, tone: 'teal' },
    start: 25.5,
    end: 26.4,
    input: 'reports/llm-prices.md',
    output: 'Saved, 4.2 KB',
  },
]

function CostWaterfallDemo() {
  const { startedAt, t, live } = useScriptClock(26.4, 5)
  const steps = React.useMemo(
    () =>
      atTime(costScript, t, step => ({
        ...step,
        end: undefined,
        cost: undefined,
        inputTokens: undefined,
        outputTokens: undefined,
        error: undefined,
        output: undefined,
      })),
    [t],
  )
  return (
    <CostWaterfall
      key={startedAt}
      subtitle="Report on LLM API prices in 2026"
      steps={steps}
      live={live}
      startedAt={startedAt}
      defaultCollapsed={['researcher']}
    />
  )
}

/* ------------------------------------------------------------ FallbackChain */

const a1: FallbackAttempt = {
  id: 'a1',
  model: 'deepseek-v4-pro',
  provider: 'DeepSeek',
  glyph: { icon: SparklesIcon, tone: 'info' },
  status: 'waiting',
  timeoutMs: 5000,
  price: '$0.55 / $2.19 per 1M',
  region: 'Primary',
}
const a2: FallbackAttempt = {
  id: 'a2',
  model: 'gpt-6',
  provider: 'Cloud A',
  glyph: { letter: 'G', tone: 'success' },
  status: 'waiting',
  timeoutMs: 5000,
  price: '$1.25 / $10 per 1M',
  region: 'Sweden Central',
}
const a3: FallbackAttempt = {
  id: 'a3',
  model: 'gemini-pro',
  provider: 'Cloud B',
  glyph: { icon: BrainIcon, tone: 'violet' },
  status: 'waiting',
  timeoutMs: 5000,
  price: '$1.25 / $5 per 1M',
  region: 'europe-west4',
}
const a4: FallbackAttempt = {
  id: 'a4',
  model: 'grok-4',
  provider: 'Cloud C',
  glyph: { icon: ZapIcon, tone: 'warning' },
  status: 'waiting',
  timeoutMs: 5000,
  price: '$3 / $15 per 1M',
  region: 'us-east',
}

/** How long each phase lasts: attempt 1 is rate limited, 2 times out, 3 answers, then a hold before the loop. */
const phaseDelays = [1600, 5000, 1900, 5000] as const
const lastPhase = phaseDelays.length - 1

/** Each phase's attempts, given when each attempt started. */
function attemptsFor(phase: number, starts: readonly number[]): FallbackAttempt[] {
  const failed1: FallbackAttempt = { ...a1, status: 'failed', reason: 'Rate limited · 429', elapsedMs: 1600, cost: 0 }
  const failed2: FallbackAttempt = { ...a2, status: 'failed', reason: 'Timed out', elapsedMs: 5000, cost: 0.0006 }
  if (phase === 0) return [{ ...a1, status: 'trying', startedAt: starts[0] }, { ...a2, status: 'next' }, a3, a4]
  if (phase === 1) return [failed1, { ...a2, status: 'trying', startedAt: starts[1] }, { ...a3, status: 'next' }, a4]
  if (phase === 2) return [failed1, failed2, { ...a3, status: 'trying', startedAt: starts[2] }, { ...a4, status: 'next' }]
  return [failed1, failed2, { ...a3, status: 'answered', elapsedMs: 1900, cost: 0.0021, tokens: 412 }, { ...a4, status: 'skipped' }]
}

interface FallbackRun {
  readonly startedAt: number
  readonly phase: number
  readonly starts: readonly number[]
}

const freshRun = (): FallbackRun => ({ startedAt: Date.now(), phase: 0, starts: [Date.now()] })

function FallbackChainDemo() {
  const [run, setRun] = React.useState(freshRun)
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setRun(current => (current.phase >= lastPhase ? freshRun() : { ...current, phase: current.phase + 1, starts: [...current.starts, Date.now()] }))
    }, phaseDelays[run.phase] ?? 1000)
    return () => window.clearTimeout(id)
  }, [run.phase, run.startedAt])
  const endedAt = run.phase === lastPhase ? run.starts[lastPhase] : undefined
  return (
    <FallbackChain
      key={run.startedAt}
      heading="Summarize support ticket"
      route="router/auto"
      attempts={attemptsFor(run.phase, run.starts)}
      startedAt={run.startedAt}
      endedAt={endedAt}
    />
  )
}

/* ------------------------------------------------------------ registry */

export const tracesDemos: readonly GalleryDemo[] = [
  {
    id: 'traces-agent-timeline',
    title: 'AgentTimeline',
    description:
      'Swimlanes for a multi-agent turn: one lane per subagent, handoff elbows, failures and retries, replayed under a playhead with rolling tokens and cost.',
    source: "import { AgentTimeline } from '@dshfiles/plugin-ui/components/motion/agent-timeline'",
    wide: true,
    render: () => <AgentTimelineDemo />,
  },
  {
    id: 'traces-trace-waterfall',
    title: 'TraceWaterfall',
    description:
      "A live span tree for a thread's turn from the traces store: spans rise in, open bars grow under the cursor, the axis rescales, the slowest step is flagged.",
    source: "import { TraceWaterfall } from '@dshfiles/plugin-ui/components/motion/trace-waterfall'",
    wide: true,
    render: () => <TraceWaterfallDemo />,
  },
  {
    id: 'traces-trace-replay',
    title: 'TraceReplay',
    description:
      'Replays a finished agent run step by step with compound agent bars and handoffs; zoom into a subagent, search steps, click a step to inspect it.',
    source: "import { TraceReplay } from '@dshfiles/plugin-ui/components/motion/trace-replay'",
    wide: true,
    render: () => <TraceReplayDemo />,
  },
  {
    id: 'traces-cost-waterfall',
    title: 'CostWaterfall',
    description: 'What each step of a run cost, as a cumulative waterfall in dollars or tokens; open a failed tool call for its error, input and output.',
    source: "import { CostWaterfall } from '@dshfiles/plugin-ui/components/motion/cost-waterfall'",
    wide: true,
    render: () => <CostWaterfallDemo />,
  },
  {
    id: 'traces-fallback-chain',
    title: 'FallbackChain',
    description:
      'Which account route answered a request: the model fallback chain walks rate limits and timeouts until one answers; hover a card for time, cost and price.',
    source: "import { FallbackChain } from '@dshfiles/plugin-ui/components/motion/fallback-chain'",
    wide: true,
    render: () => <FallbackChainDemo />,
  },
]
