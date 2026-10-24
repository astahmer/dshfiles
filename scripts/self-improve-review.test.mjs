import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SessionCorpus } from './self-improve-corpus.ts'
import { SessionReview } from './self-improve-review.ts'
import { run } from './self-improve.ts'

const write = (path, content) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const record = value => `${JSON.stringify(value)}\n`

const DAY = 86_400_000

/**
 * One Session whose tool calls fail with `failure` — the shape that becomes a
 * `tool-error` signal, repeated across Sessions by the caller.
 */
const failingSession = ({ id, failure, errors }) =>
  [
    record({ type: 'session', id, createdAt: 1_700_000_000_000, cwd: '/tmp/ws' }),
    record({ type: 'session/title', seq: 1, time: 1_700_000_000_100, data: { title: `task ${id}` } }),
    record({ type: 'turn/start', seq: 2, time: 1_700_000_000_200, data: { turn: 1 } }),
    record({ type: 'user/message', seq: 3, time: 1_700_000_000_300, data: { content: [{ type: 'text', text: 'do the thing' }], source: { kind: 'user' } } }),
    ...Array.from({ length: errors }, (_, index) => {
      const seq = 10 + index * 2
      const callId = `call-${String(index)}`
      return [
        record({
          type: 'tool/call',
          seq,
          time: 1_700_000_000_400 + index * 200,
          data: { turn: 1, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command: `jj status ${String(index)}` }) },
        }),
        record({
          type: 'tool/result',
          seq: seq + 1,
          time: 1_700_000_000_500 + index * 200,
          data: {
            message: { role: 'tool', toolCallId: callId, isError: true, content: [{ type: 'text', text: `Error: ${failure}\n    at /tmp/ws/file.ts` }] },
          },
        }),
      ]
    }).flat(),
    record({ type: 'turn/end', seq: 90, time: 1_700_000_000_900, data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('')

const makeCorpus = ({ name, sessions }) => {
  const home = mkdtempSync(join(tmpdir(), `self-improve-${name}-`))
  for (const session of sessions) {
    const path = join(home, 'sessions', session.project, session.id, 'session.jsonl')
    write(path, failingSession({ id: session.id, failure: session.failure, errors: session.errors }))
    utimesSync(path, new Date(session.at), new Date(session.at))
  }
  return home
}

const loadWindow = (home, { from, to }) =>
  SessionCorpus.load({ dshHome: home, sinceMs: from, untilMs: to, projects: [], sessionLimit: Number.POSITIVE_INFINITY })

test('a review classifies each signal against the previous window', async () => {
  const now = Date.now()
  const currentFrom = now - 7 * DAY
  const previousFrom = now - 14 * DAY
  const home = makeCorpus({
    name: 'review',
    sessions: [
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `current-worse-${String(index)}`,
        project: 'alpha',
        failure: 'jj workspace add failed',
        errors: 2,
        at: now - 2 * DAY,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `previous-worse-${String(index)}`,
        project: 'alpha',
        failure: 'jj workspace add failed',
        errors: 1,
        at: now - 9 * DAY,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `current-new-${String(index)}`,
        project: 'beta',
        failure: 'schema projection collapsed',
        errors: 1,
        at: now - 3 * DAY,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `previous-better-${String(index)}`,
        project: 'beta',
        failure: 'obsolete provider error',
        errors: 2,
        at: now - 10 * DAY,
      })),
    ],
  })

  const current = await loadWindow(home, { from: currentFrom, to: now })
  const previous = await loadWindow(home, { from: previousFrom, to: currentFrom })
  const report = SessionReview.build({
    now,
    since: '7d',
    current,
    previous,
    currentWindow: { from: currentFrom, to: now },
    previousWindow: { from: previousFrom, to: currentFrom },
    ledger: [],
    top: 5,
  })

  assert.equal(report.current.sessions, 8)
  assert.equal(report.previous.sessions, 8)
  assert.equal(report.currentVitals.toolErrors, 13)
  assert.equal(report.previousVitals.toolErrors, 13)

  const worse = report.deltas.find(delta => delta.title.includes('jj workspace add failed'))
  assert.equal(worse?.change, 'worse')
  assert.equal(worse?.previousHits, 3)
  assert.equal(worse?.currentHits, 10)

  const fresh = report.deltas.find(delta => delta.title.includes('schema projection collapsed'))
  assert.equal(fresh?.change, 'new')

  const better = report.deltas.find(delta => delta.title.includes('obsolete provider error'))
  assert.equal(better, undefined, 'a signal absent from the current window cannot be a current delta')

  assert.equal(report.candidates[0]?.delta.change, 'new')
  assert.ok(report.caveats.some(caveat => /trace retention/i.test(caveat)))
})

test('a review marks a candidate the ledger already tracks', async () => {
  const now = Date.now()
  const currentFrom = now - 7 * DAY
  const home = makeCorpus({
    name: 'tracked',
    sessions: Array.from({ length: 4 }, (_, index) => ({ id: `s-${String(index)}`, project: 'alpha', failure: 'tool exploded', errors: 2, at: now - DAY })),
  })
  const empty = await loadWindow(home, { from: now - 14 * DAY, to: currentFrom })
  const current = await loadWindow(home, { from: currentFrom, to: now })
  const signal = SessionReview.build({
    now,
    since: '7d',
    current,
    previous: empty,
    currentWindow: { from: currentFrom, to: now },
    previousWindow: { from: now - 14 * DAY, to: currentFrom },
    ledger: [],
    top: 5,
  }).candidates[0]
  assert.ok(signal)

  const tracked = SessionReview.build({
    now,
    since: '7d',
    current,
    previous: empty,
    currentWindow: { from: currentFrom, to: now },
    previousWindow: { from: now - 14 * DAY, to: currentFrom },
    ledger: [{ key: signal.delta.id, status: 'investigating' }],
    top: 5,
  })
  assert.equal(tracked.candidates[0]?.ledgerStatus, 'investigating')
})

test('a log exactly at the window boundary belongs to the earlier window only', async () => {
  const now = Date.now()
  const boundary = now - 7 * DAY
  const home = makeCorpus({
    name: 'boundary',
    sessions: [
      { id: 'before', project: 'alpha', failure: 'boundary one', errors: 1, at: boundary - 1000 },
      { id: 'after', project: 'alpha', failure: 'boundary two', errors: 1, at: boundary + 1000 },
    ],
  })
  const earlier = await loadWindow(home, { from: now - 14 * DAY, to: boundary })
  const later = await loadWindow(home, { from: boundary, to: now })
  assert.deepEqual(
    earlier.facts.map(facts => facts.sessionId),
    ['before'],
  )
  assert.deepEqual(
    later.facts.map(facts => facts.sessionId),
    ['after'],
  )
})

test('review writes a markdown and JSON artifact and prints a summary', async () => {
  const now = Date.now()
  const home = makeCorpus({
    name: 'cli',
    sessions: [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `now-${String(index)}`, project: 'alpha', failure: 'repeated failure', errors: 2, at: now - DAY })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `then-${String(index)}`,
        project: 'alpha',
        failure: 'repeated failure',
        errors: 1,
        at: now - 9 * DAY,
      })),
    ],
  })
  const out = join(home, 'review-out')
  const code = await run(['review', `--dsh-home=${home}`, '--since=7d', `--out=${out}`, '--quiet=true', '--no-cache=true'])
  assert.equal(code, 0)

  const { readdirSync } = await import('node:fs')
  const markdown = readdirSync(out).find(name => name.startsWith('review-') && name.endsWith('.md'))
  const json = readdirSync(out).find(name => name.startsWith('review-') && name.endsWith('.json'))
  assert.ok(markdown)
  assert.ok(json)

  const text = await readFile(join(out, markdown), 'utf8')
  assert.match(text, /^# Self-improve weekly review/)
  assert.match(text, /## Vitals/)
  assert.match(text, /## What got worse/)
  assert.match(text, /## Limits of this report/)

  const report = JSON.parse(await readFile(join(out, json), 'utf8'))
  assert.equal(typeof report.current.from, 'number')
  assert.ok(Array.isArray(report.candidates))
})
