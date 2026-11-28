import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as Schema from 'effect/Schema'
import { traceDetailSchema } from '../plugins/@dshfiles/traces/src/types.ts'

const decodeTrace = Schema.decodeUnknownSync(traceDetailSchema)
const isNonEmptyString = Schema.is(Schema.String.check(Schema.isMinLength(1)))
const isPrice = Schema.is(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)))
const MAX_BYTES = 2 * 1024 * 1024
const MAX_SPANS = 2_048
const operation = span => span.attributes['gen_ai.operation.name']
const isChat = span => operation(span) === 'chat'
const isTool = span => operation(span) === 'execute_tool'
const isWait = span => isTool(span) && span.attributes['gen_ai.tool.name'] === 'wait_agent'
// The repository stores integer microseconds, then exposes offset and duration separately in ms.
const US_PER_MS = 1_000
const withTiming = span => {
  const startUs = Math.round(span.offsetMs * US_PER_MS)
  const durationUs = Math.round(span.durationMs * US_PER_MS)
  const endUs = startUs + durationUs
  if (![startUs, durationUs, endUs].every(Number.isSafeInteger)) throw new Error('Span timing exceeds microsecond range')
  // A zero duration can represent an absent or invalid end. The start is still recorded.
  return { ...span, startUs, endUs: durationUs > 0 ? endUs : null }
}
const chronological = (a, b) => a.startUs - b.startUs || a.spanId.localeCompare(b.spanId)
const turnOf = span => (Number.isSafeInteger(span.attributes['dsh.turn']) ? span.attributes['dsh.turn'] : null)
const stringOrNull = value => (isNonEmptyString(value) ? value : null)
const isNormalChat = span => isChat(span) && span.attributes['dsh.llm.standalone'] !== true && Number.isSafeInteger(span.attributes['dsh.llm.attempt'])

const sameRoute = (a, b) => {
  const pairs = ['gen_ai.provider.name', 'gen_ai.request.model'].map(key => [stringOrNull(a.attributes[key]), stringOrNull(b.attributes[key])])
  return pairs.some(pair => pair.includes(null)) ? null : pairs.every(([left, right]) => left === right)
}

/** A PTC tool has no dsh.turn; use its nearest recorded same-session ancestor turn. */
const waitTurn = (span, byId) => {
  const seen = new Set()
  let current = span
  while (current !== undefined && current.sessionId === span.sessionId && !seen.has(current.spanId)) {
    const turn = turnOf(current)
    if (turn !== null) return turn
    seen.add(current.spanId)
    current = byId.get(current.parentSpanId)
  }
  return null
}

/** Intervals are already sorted by start; simultaneous waits count once. */
const unionUs = spans => {
  let total = 0
  let coveredUntil = -Infinity
  for (const span of spans) {
    total += Math.max(0, span.endUs - Math.max(coveredUntil, span.startUs))
    coveredUntil = Math.max(coveredUntil, span.endUs)
  }
  return total
}

/** Offline observation from one normalized trace. It cannot identify a child-caused wait or cache expiry. */
export const diagnoseParentWait = (input, sessionId) => {
  if (!isNonEmptyString(sessionId) || sessionId.trim() === '') throw new Error('Expected an explicit parent session id')
  const trace = decodeTrace(input)
  if (trace.spans.length > MAX_SPANS) throw new Error('Trace exceeds the diagnostic span limit')
  const byId = new Map()
  for (const span of trace.spans) {
    if (byId.has(span.spanId)) throw new Error('Duplicate span id')
    byId.set(span.spanId, withTiming(span))
  }
  const spans = [...byId.values()].filter(span => span.sessionId === sessionId).sort(chronological)
  const chats = spans.filter(isChat)
  const normal = chats.filter(isNormalChat)
  const tools = spans.filter(isTool)
  const waits = tools.filter(span => isWait(span) && span.status === 'ok' && span.endUs !== null).map(span => ({ span, turn: waitTurn(span, byId) }))
  const observations = []
  for (let i = 1; i < normal.length; i++) {
    const previous = normal[i - 1]
    const next = normal[i]
    const turn = turnOf(previous)
    const from = previous.endUs
    const to = next.startUs
    if (turn === null || turn !== turnOf(next) || from === null || from >= to) continue
    const gapUs = to - from
    if (!Number.isSafeInteger(gapUs)) throw new Error('Attempt gap exceeds microsecond range')
    // Half-open gap for overlap; full enclosure (including boundaries) for qualifying waits.
    const overlaps = span => span.endUs !== null && span.startUs < to && span.endUs > from
    const matched = waits.filter(wait => wait.turn === turn && wait.span.startUs >= from && wait.span.endUs <= to).map(wait => wait.span)
    if (matched.length === 0) continue
    const matchedIds = new Set(matched.map(span => span.spanId))
    const writeTokens = next.attributes['gen_ai.usage.cache_creation.input_tokens']
    const listTotal = next.attributes['dshx.cost.usd']
    const nextChatListPriceTotalUsd = isPrice(listTotal) ? listTotal : null
    observations.push({
      turn,
      previousChatSpanId: previous.spanId,
      nextChatSpanId: next.spanId,
      pairwiseAttemptGapMs: gapUs / US_PER_MS,
      recordedWaitAgentUnionMs: unionUs(matched) / US_PER_MS,
      inboxWaitSpanIds: [...matchedIds],
      otherToolSpanIdsInGap: tools.filter(span => !matchedIds.has(span.spanId) && overlaps(span)).map(span => span.spanId),
      otherParentChatSpanIdsInGap: chats.filter(span => span !== previous && span !== next && overlaps(span)).map(span => span.spanId),
      sameRecordedRoute: sameRoute(previous, next),
      nextChatStatus: next.status,
      reportedCacheWriteTokens: Number.isSafeInteger(writeTokens) && writeTokens >= 0 ? writeTokens : null,
      nextChatListPriceTotalUsd,
      nextChatListPriceCatalogId: nextChatListPriceTotalUsd === null ? null : stringOrNull(next.attributes['dshx.cost.price_id']),
    })
  }
  return { traceId: trace.traceId, sessionId, observations }
}

const main = async () => {
  const [sessionId, ...extra] = process.argv.slice(2)
  if (sessionId === undefined || extra.length > 0 || process.stdin.isTTY) throw new Error('Expected a session id and trace JSON on stdin')
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_BYTES) throw new Error('Trace exceeds the diagnostic byte limit')
    chunks.push(chunk)
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  console.log(JSON.stringify(diagnoseParentWait(input, sessionId), null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => {
    // The decoder's error may include input values. Do not echo trace content.
    console.error('Use: node scripts/parent-cache-wait.mjs parent-session-id < trace.json (one traces_get result, at most 2 MiB and 2,048 spans).')
    process.exitCode = 1
  })
}
