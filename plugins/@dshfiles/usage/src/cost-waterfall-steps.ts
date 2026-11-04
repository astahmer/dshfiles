import type { CostStep } from '@dshfiles/plugin-ui/components/motion/cost-waterfall'
import type { RequestView } from './api.js'

/** Most recent turns the thread Cost facet draws as a waterfall; older turns stay in the Per turn table. */
export const WATERFALL_TURN_LIMIT = 40

export interface CostWaterfallSteps {
  readonly steps: readonly CostStep[]
  /** Turns left out because only the most recent {@link WATERFALL_TURN_LIMIT} are drawn. */
  readonly hiddenTurns: number
}

const SIDE_ID = 'side'

const groupId = (turn: number | null): string => (turn === null ? SIDE_ID : `turn-${String(turn)}`)

/**
 * Group names deliberately carry the request count: a bare `Turn n` would duplicate the Per turn table's labels,
 * which the Usage e2e journey finds with `getByText(/^Turn \d+$/)`.
 */
const groupName = (turn: number | null, requests: number): string => {
  const count = `${String(requests)} ${requests === 1 ? 'request' : 'requests'}`
  return turn === null ? `Side requests · ${count}` : `Turn ${String(turn)} · ${count}`
}

/**
 * One thread's requests as CostWaterfall steps: a group per turn (oldest first, side requests last) whose children are
 * that turn's requests in start order. Times are seconds from the earliest drawn request; groups span their children.
 */
const stepsOf = (rows: readonly RequestView[], turnLimit: number = WATERFALL_TURN_LIMIT): CostWaterfallSteps => {
  const byTurn = new Map<number | null, RequestView[]>()
  for (const row of rows) {
    const list = byTurn.get(row.turn) ?? []
    list.push(row)
    byTurn.set(row.turn, list)
  }
  const numbered = [...byTurn.keys()].filter((turn): turn is number => turn !== null).sort((left, right) => left - right)
  const kept = numbered.slice(Math.max(0, numbered.length - turnLimit))
  const hiddenTurns = numbered.length - kept.length
  const order: (number | null)[] = byTurn.has(null) ? [...kept, null] : kept
  const drawn = order.flatMap(turn => byTurn.get(turn) ?? [])
  const origin = drawn.reduce((min, row) => Math.min(min, row.startedAt), Number.POSITIVE_INFINITY)

  const steps: CostStep[] = []
  for (const turn of order) {
    const requests = [...(byTurn.get(turn) ?? [])].sort((left, right) => left.startedAt - right.startedAt || left.id.localeCompare(right.id))
    const parentId = groupId(turn)
    const children: CostStep[] = requests.map(row => {
      const start = (row.startedAt - origin) / 1000
      return {
        id: row.id,
        parentId,
        name: row.purpose,
        detail: row.model,
        start,
        end: start + (row.durationMs ?? 0) / 1000,
        inputTokens: (row.input ?? 0) + (row.cacheRead ?? 0) + (row.cacheWrite ?? 0),
        outputTokens: row.output ?? 0,
        cost: row.cost ?? undefined,
        error: row.status === 'failed' ? (row.errorCode ?? 'failed') : undefined,
      }
    })
    steps.push({
      id: parentId,
      name: groupName(turn, requests.length),
      start: children.reduce((min, child) => Math.min(min, child.start), Number.POSITIVE_INFINITY),
      end: children.reduce((max, child) => Math.max(max, child.end ?? child.start), 0),
    })
    steps.push(...children)
  }
  return { steps, hiddenTurns }
}

export class ThreadCostWaterfall {
  static readonly stepsOf = stepsOf
}
