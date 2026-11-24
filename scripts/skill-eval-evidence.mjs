import * as Schema from 'effect/Schema'

const nonEmpty = Schema.String.check(Schema.isMinLength(1))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const completed = Schema.Struct({ kind: Schema.Literal('completed') })
const usage = Schema.Struct({
  inputTokens: count,
  outputTokens: count,
  totalTokens: Schema.optionalKey(count),
  cacheReadTokens: Schema.optionalKey(count),
  cacheWriteTokens: Schema.optionalKey(count),
  reasoningTokens: Schema.optionalKey(count),
})
const status = (phase, extra = {}) => Schema.Struct({ type: Schema.Literal('status'), phase: Schema.Literal(phase), turn: count, ...extra })
const record = Schema.Union([
  Schema.Struct({ type: Schema.Literal('session'), sessionId: nonEmpty, cwd: nonEmpty }),
  status('turn_start'),
  status('step_start', { step: count }),
  status('step_end', { step: count, usage: Schema.optionalKey(usage) }),
  status('turn_end', { reason: completed }),
  Schema.Struct({ type: Schema.Literals(['text', 'thinking']), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('tool_call'), tool: nonEmpty, callId: nonEmpty, input: Schema.Json }),
  Schema.Struct({ type: Schema.Literal('tool_result'), callId: nonEmpty, status: Schema.Literal('completed'), result: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('tool_result'),
    callId: nonEmpty,
    status: Schema.Literal('error'),
    result: Schema.String,
    error: Schema.optionalKey(Schema.JsonObject),
  }),
  Schema.Struct({ type: Schema.Literal('final'), sessionId: nonEmpty, reason: completed, text: Schema.String }),
])
// Reject excess fields, including the stock projection's `truncated` marker: a clipped skill body is not evidence.
const decodeStream = Schema.decodeUnknownOption(Schema.Array(record), { onExcessProperty: 'error' })
const validTarget = Schema.is(Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)))

const nativeBody = (result, target) => {
  const prefix = `<skill_content name="${target}">\n<skill_resources>\n`
  const opening = '\n</skill_resources>\n\n<skill_instructions>\n'
  const closing = '\n</skill_instructions>\n</skill_content>'
  const body = result.indexOf(opening, prefix.length)
  return result.startsWith(prefix) && body >= 0 && result.endsWith(closing) && result.slice(body + opening.length, -closing.length).trim() !== ''
}

/**
 * Classify a single fresh, completed turn from stock 0.2.2-rc.2 headless JSON.
 * Check the whole projection even after a timely load. This does not prove
 * provenance, model-visible content, a successful process exit, or safety.
 */
function skillLoadStatus(events, target) {
  const decoded = decodeStream(events)
  if (decoded._tag === 'None' || !validTarget(target)) return 'indeterminate'
  const [session, start, ...rest] = decoded.value
  if (session?.type !== 'session' || start?.type !== 'status' || start.phase !== 'turn_start' || start.turn !== 1) return 'indeterminate'

  let step
  let lastStep = 0
  let stepText = ''
  let answerText = ''
  let ended = false
  let otherActivity = false
  let load = 'not-loaded'
  const seen = new Set()
  const pending = new Map()
  for (const [index, event] of rest.entries()) {
    if (event.type === 'final') {
      return ended && index === rest.length - 1 && event.sessionId === session.sessionId && event.text === answerText ? load : 'indeterminate'
    }
    if (ended) return 'indeterminate'
    if (event.type === 'status' && event.turn === start.turn) {
      if (event.phase === 'step_start' && step === undefined && event.step === lastStep + 1) {
        step = event.step
        stepText = ''
      } else if (event.phase === 'step_end' && step !== undefined && event.step === step && pending.size === 0) {
        lastStep = step
        step = undefined
        if (stepText !== '') answerText = stepText
      } else if (event.phase === 'turn_end' && step === undefined && lastStep > 0) {
        ended = true
      } else {
        return 'indeterminate'
      }
    } else if (step === undefined) {
      return 'indeterminate'
    } else if (event.type === 'tool_call') {
      if (seen.has(event.callId)) return 'indeterminate'
      const targetCall = event.tool === 'skill' && event.input?.name === target
      if (targetCall && Object.keys(event.input).length !== 1) return 'indeterminate'
      seen.add(event.callId)
      pending.set(event.callId, targetCall)
      if (!targetCall) otherActivity = true
    } else if (event.type === 'tool_result') {
      if (!pending.has(event.callId)) return 'indeterminate'
      if (pending.get(event.callId) && event.status === 'completed') {
        if (!nativeBody(event.result, target)) return 'indeterminate'
        if (load === 'not-loaded') load = otherActivity ? 'late' : 'loaded'
      } else if (event.result.includes(`<skill_content name="${target}">`)) {
        // A target body on any other path is not evidence of native discovery.
        return 'indeterminate'
      }
      pending.delete(event.callId)
    } else if (event.type === 'text') {
      stepText += event.text
    } else if (event.type !== 'thinking') {
      return 'indeterminate'
    }
  }
  return 'indeterminate'
}

const fourDecisions = Schema.is(Schema.Tuple([Schema.Boolean, Schema.Boolean, Schema.Boolean, Schema.Boolean]))

/** Compare two human-graded arms. Unknown evidence and safety failures never win. */
function scoreSkillPair(pair) {
  const { comparable, on, off } = pair ?? {}
  if (on?.safety === 'fail' || off?.safety === 'fail') return { verdict: 'unsafe', delta: null }
  const rated = arm => arm?.safety === 'pass' && fourDecisions(arm.criteria)
  if (comparable !== true || !rated(on) || !rated(off) || !['loaded', 'late', 'not-loaded'].includes(on.load) || off.load !== 'not-loaded')
    return { verdict: 'indeterminate', delta: null }
  const delta = on.criteria.filter(Boolean).length - off.criteria.filter(Boolean).length
  return { verdict: delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'tie', delta }
}

export class SkillEvalEvidence {
  static skillLoadStatus = skillLoadStatus
  static scoreSkillPair = scoreSkillPair
}
