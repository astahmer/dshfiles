import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SkillEvalEvidence } from './skill-eval-evidence.mjs'

const { scoreSkillPair, skillLoadStatus } = SkillEvalEvidence

const cases = JSON.parse(readFileSync(new URL('../docs/skill-eval-cases.json', import.meta.url), 'utf8'))
const targets = ['verify-dsh', 'dsh-plugin-verify']

test('the pilot has two unnamed, plan-only prompts and four criteria per skill case', () => {
  assert.equal(new Set(cases.map(item => item.id)).size, cases.length)
  assert.equal(new Set(cases.map(item => item.prompt)).size, cases.length)
  assert.deepEqual([...new Set(cases.map(item => item.skill))].sort(), [...targets].sort())
  for (const skill of targets) {
    assert.equal(cases.filter(item => item.skill === skill).length, 2)
    assert.match(readFileSync(new URL(`../.agents/skills/${skill}/SKILL.md`, import.meta.url), 'utf8'), new RegExp(`^name: ${skill}$`, 'm'))
  }
  for (const item of cases) {
    for (const skill of targets) assert.ok(!item.prompt.toLowerCase().includes(skill), `${item.id} names ${skill}`)
    assert.match(item.prompt, /don't (start|run|modify|make edits)/i)
    assert.equal(Object.values(item.criteria).length, 4)
    assert.ok(Object.values(item.criteria).every(criterion => typeof criterion === 'string' && criterion.trim() !== ''))
  }
})

// Fabricated stock 0.2.2-rc.2 headless projection records, not samples from a DSH run.
const skill = 'verify-dsh'
const call = { type: 'tool_call', tool: 'skill', input: { name: skill }, callId: 'a' }
const other = { type: 'tool_call', tool: 'read', input: {}, callId: 'b' }
const read = { type: 'tool_result', status: 'completed', callId: 'b', result: 'fixture' }
const loaded = {
  type: 'tool_result',
  status: 'completed',
  callId: 'a',
  result:
    '<skill_content name="verify-dsh">\n<skill_resources>\nfixture\n</skill_resources>\n\n<skill_instructions>\nfixture\n</skill_instructions>\n</skill_content>',
}
const failed = { type: 'tool_result', status: 'error', callId: 'a', result: 'not available', error: { code: 'FIXTURE' } }
const sessionId = 'session-fixture'
const done = { kind: 'completed' }
const final = { type: 'final', sessionId, text: 'I used verify-dsh.', reason: done }
const step = (number, ...events) => [
  { type: 'status', phase: 'step_start', turn: 1, step: number + 1 },
  ...events,
  { type: 'status', phase: 'step_end', turn: 1, step: number + 1, usage: { inputTokens: 0, outputTokens: 0 } },
]
const stream = (...steps) => [
  { type: 'session', sessionId, cwd: '/eval/project' },
  { type: 'status', phase: 'turn_start', turn: 1 },
  ...steps.flat(),
  { type: 'status', phase: 'turn_end', turn: 1, reason: done },
  final,
]
const answer = number => step(number, { type: 'thinking', text: 'fixture' }, { type: 'text', text: final.text })
const classify = (...events) => skillLoadStatus(stream(step(0, ...events), answer(1)), skill)

test('separates a timely load, late load, failed attempt, and answer without a load', () => {
  assert.equal(classify(call, loaded, other, read), 'loaded')
  assert.equal(classify(call, other, loaded, read), 'late')
  assert.equal(skillLoadStatus(stream(step(0, other, read), step(1, call, loaded), answer(2)), skill), 'late')
  assert.equal(classify(call, failed), 'not-loaded')
  assert.equal(skillLoadStatus(stream(answer(0)), skill), 'not-loaded')
})

test('rejects correlation and body defects even after a valid early load', () => {
  const malformed = [
    [call],
    [loaded, call],
    [call, call, loaded],
    [call, loaded, call, loaded],
    [call, loaded, loaded],
    [call, loaded, other],
    [call, loaded, read],
    [call, { ...loaded, status: 'success' }],
    [call, { ...loaded, result: loaded.result.replace('verify-dsh', 'dsh-plugin-verify') }],
    [call, { ...loaded, result: '<skill_content name="verify-dsh">\n</skill_content>' }],
    [call, { ...loaded, result: loaded.result.replace('<skill_instructions>\nfixture', '<skill_instructions>\n') }],
    [call, { ...loaded, truncated: true }],
    [call, loaded, { ...other, truncated: true }],
    [other, { ...loaded, callId: other.callId }],
    [{ type: 'user/message', source: { kind: 'skill-invocation' }, content: loaded.result }],
    [null],
  ]
  for (const events of malformed) assert.equal(classify(...events), 'indeterminate', JSON.stringify(events))
  assert.equal(skillLoadStatus(stream(step(0, call, loaded), step(1, call, loaded), answer(2)), skill), 'indeterminate')
  assert.equal(skillLoadStatus(stream(step(0, call), step(1, loaded), answer(2)), skill), 'indeterminate')
})

test('requires precisely one ordered turn with matching completed terminal records', () => {
  const valid = stream(step(0, call, loaded), answer(1))
  assert.equal(skillLoadStatus(valid, skill), 'loaded')
  const invalid = [
    [final],
    valid.slice(1),
    valid.slice(0, -1),
    [...valid, final],
    [...valid.slice(0, -2), final],
    [...valid.slice(0, -1), { ...final, reason: 'complete' }],
    [...valid.slice(0, -1), { ...final, reason: { kind: 'max-tokens' } }],
    [...valid.slice(0, -1), { ...final, sessionId: 'other-session' }],
    [...valid.slice(0, -1), { ...final, text: 'not the committed assistant text' }],
    [...valid.slice(0, -2), { ...valid.at(-2), reason: { kind: 'blocked' } }, final],
    [...valid.slice(0, -1), { type: 'error', message: 'fixture' }, final],
    stream(answer(0), answer(2)),
    stream(answer(1)),
    valid.map(event => (Object.hasOwn(event, 'turn') ? { ...event, turn: 2 } : event)),
  ]
  for (const events of invalid) assert.equal(skillLoadStatus(events, skill), 'indeterminate', JSON.stringify(events))
})

const grade = (load, criteria) => ({ load, safety: 'pass', criteria })
const on = grade(classify(call, loaded), [true, true, true, true])
const off = grade(classify(), [true, true, false, false])

test('quality deltas are separate from successful and timely routing', () => {
  for (const load of [on.load, classify(call, other, loaded, read), classify()]) {
    assert.deepEqual(scoreSkillPair({ comparable: true, on: { ...on, load }, off }), { verdict: 'improved', delta: 2 })
  }
  assert.deepEqual(scoreSkillPair({ comparable: true, on: off, off }), { verdict: 'tie', delta: 0 })
  assert.deepEqual(scoreSkillPair({ comparable: true, on: off, off: { ...on, load: 'not-loaded' } }), { verdict: 'regressed', delta: -2 })
})

test('unsafe, incomplete and contaminated pairs never produce an improvement verdict', () => {
  assert.deepEqual(scoreSkillPair({ comparable: true, on: { ...on, safety: 'fail' }, off }), { verdict: 'unsafe', delta: null })
  assert.deepEqual(scoreSkillPair({ comparable: true, on, off: { ...off, safety: 'fail' } }), { verdict: 'unsafe', delta: null })
  const incomplete = [
    { comparable: false, on, off },
    { comparable: true, on: { ...on, safety: 'unknown' }, off },
    { comparable: true, on: { ...on, load: classify(call) }, off },
    { comparable: true, on, off: { ...off, load: classify(call, loaded) } },
    { comparable: true, on, off: { ...off, criteria: [true, false] } },
    { comparable: true, on, off: null },
  ]
  for (const pair of incomplete) assert.deepEqual(scoreSkillPair(pair), { verdict: 'indeterminate', delta: null })
})
