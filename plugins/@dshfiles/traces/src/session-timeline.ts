import type { AgentTimelineLane, AgentTimelineSegment } from '@dshfiles/plugin-ui/components/motion/agent-timeline'
import { TraceFormat } from './format.js'
import type { TraceDetail } from './types.js'
import { WaterfallSpans } from './waterfall-spans.js'

export type SessionTimelineLaneId = 'turns' | 'model' | 'tools'

export interface SessionTimeline {
  readonly lanes: readonly AgentTimelineLane[]
  readonly segments: readonly AgentTimelineSegment[]
  /** Seconds of busy time on the axis, idle gaps between traces squeezed out. */
  readonly duration: number
}

interface BusyBlock {
  readonly startMs: number
  readonly endMs: number
}

/** Share of the busy time each squeezed idle gap keeps on the axis, so turns stay visibly apart. */
const GAP_SHARE = 0.02
const MIN_GAP_MS = 200

/** Overlapping trace intervals merged into busy blocks, oldest first. */
const busyBlocks = (traces: readonly TraceDetail[]): readonly BusyBlock[] => {
  const blocks: BusyBlock[] = []
  for (const trace of [...traces].sort((left, right) => left.startMs - right.startMs)) {
    const last = blocks.at(-1)
    const endMs = trace.startMs + trace.durationMs
    if (last !== undefined && trace.startMs <= last.endMs) blocks[blocks.length - 1] = { startMs: last.startMs, endMs: Math.max(last.endMs, endMs) }
    else blocks.push({ startMs: trace.startMs, endMs })
  }
  return blocks
}

/**
 * A thread's traces as one timeline: a lane of turns (one block per trace), a lane of model calls and a lane of tool
 * calls. Wall time between traces is idle and would dwarf the work, so each gap shrinks to a small fixed space; the
 * time inside a trace keeps its real length.
 */
const build = (input: { readonly traces: readonly TraceDetail[]; readonly laneNames: Readonly<Record<SessionTimelineLaneId, string>> }): SessionTimeline => {
  const blocks = busyBlocks(input.traces)
  const busyMs = blocks.reduce((sum, block) => sum + (block.endMs - block.startMs), 0)
  const gapMs = Math.max(MIN_GAP_MS, busyMs * GAP_SHARE)
  const axisStarts = blocks.map((block, index) => blocks.slice(0, index).reduce((sum, previous) => sum + (previous.endMs - previous.startMs) + gapMs, 0))
  const toSeconds = (wallMs: number): number => {
    const index = blocks.findLastIndex(block => block.startMs <= wallMs)
    const block = blocks[index]
    if (block === undefined) return 0
    return ((axisStarts[index] ?? 0) + Math.min(wallMs, block.endMs) - block.startMs) / 1000
  }

  const segments: AgentTimelineSegment[] = []
  const counts = { turns: 0, model: 0, tools: 0 }
  for (const trace of input.traces) {
    counts.turns++
    const failed = trace.spans.some(span => span.status === 'error')
    segments.push({
      id: trace.traceId,
      laneId: 'turns',
      kind: failed ? 'failed' : 'thinking',
      start: toSeconds(trace.startMs),
      end: toSeconds(trace.startMs + trace.durationMs),
      label: trace.spans[0]?.name,
    })
    for (const span of trace.spans) {
      const kind = WaterfallSpans.kindOf(span.attributes)
      if (kind !== 'model' && kind !== 'tool') continue
      counts[kind === 'model' ? 'model' : 'tools']++
      const startMs = trace.startMs + span.offsetMs
      segments.push({
        id: `${trace.traceId}:${span.spanId}`,
        laneId: kind === 'model' ? 'model' : 'tools',
        kind: span.status === 'error' ? 'failed' : kind === 'model' ? 'thinking' : 'tool',
        start: toSeconds(startMs),
        end: toSeconds(startMs + span.durationMs),
        label: span.name,
        tokens: WaterfallSpans.tokensOf(span.attributes),
        cost: TraceFormat.spanCostUsd(span.attributes) ?? undefined,
      })
    }
  }

  const lane = (id: SessionTimelineLaneId, tone: AgentTimelineLane['tone']): AgentTimelineLane => ({
    id,
    name: input.laneNames[id],
    model: String(counts[id]),
    tone,
  })
  return {
    lanes: [lane('turns', 'info'), lane('model', 'violet'), lane('tools', 'teal')],
    segments,
    duration: (busyMs + gapMs * Math.max(0, blocks.length - 1)) / 1000,
  }
}

export const SessionTimelineModel = { build } as const
