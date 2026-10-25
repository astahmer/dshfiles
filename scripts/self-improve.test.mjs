import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import { HarnessAudit } from './self-improve-harness.ts'
import { ImprovementLedger } from './self-improve-ledger.ts'
import { SessionLogs } from './self-improve-log.ts'
import { SessionMiner } from './self-improve-mine.ts'
import { run } from './self-improve.ts'

const write = (path, content) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

const record = value => `${JSON.stringify(value)}\n`

/** Two Sessions in two projects, each repeating the same bash call and failing the same way. */
const sessionLines = ({ id, title, command, errorText }) =>
  [
    record({ type: 'session', id, createdAt: 1_700_000_000_000, cwd: '/tmp/ws' }),
    record({ type: 'session/title', seq: 1, time: 1_700_000_000_100, data: { title } }),
    record({ type: 'turn/start', seq: 2, time: 1_700_000_000_200, data: { turn: 1 } }),
    record({ type: 'user/message', seq: 3, time: 1_700_000_000_300, data: { content: [{ type: 'text', text: '# Handoff — do the thing' }] } }),
    record({
      type: 'tool/call',
      seq: 4,
      time: 1_700_000_000_400,
      data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'jj status' }) },
    }),
    record({
      type: 'tool/result',
      seq: 5,
      time: 1_700_000_000_500,
      data: { message: { role: 'tool', toolCallId: 'c1', isError: true, content: [{ type: 'text', text: `Error: ${errorText}\n at /tmp/ws/file.ts` }] } },
    }),
    ...['c2', 'c3', 'c4'].map((callId, index) => [
      record({
        type: 'tool/call',
        seq: 6 + index * 2,
        time: 1_700_000_001_000 + index * 100,
        data: { turn: 1, step: 1, callId, name: 'bash', arguments: JSON.stringify({ command }) },
      }),
      record({
        type: 'tool/result',
        seq: 7 + index * 2,
        time: 1_700_000_001_050 + index * 100,
        data: { message: { role: 'tool', toolCallId: callId, isError: false, content: [{ type: 'text', text: 'ok' }] } },
      }),
    ]),
    record({
      type: 'llm/retry',
      seq: 20,
      time: 1_700_000_002_000,
      data: { provider: 'codex', mode: 'normal', retry: 1, failure: { code: 'TIMEOUT', message: 'pi-ai stream idle timeout after 300000ms' } },
    }),
    record({
      type: 'user/message',
      seq: 21,
      time: 1_700_000_003_000,
      data: { content: [{ type: 'text', text: "no, that's not what I asked. still broken." }] },
    }),
    record({ type: 'turn/end', seq: 22, time: 1_700_000_004_000, data: { turn: 1, reason: { kind: 'interrupted' } } }),
  ]
    .flat()
    .join('')

const SESSION_LOGS = [
  { project: 'project-alpha', session: 'session-aaa', id: 'session-aaa', title: 'Alpha work' },
  { project: 'project-beta', session: 'session-bbb', id: 'session-bbb', title: 'Beta work' },
  { project: 'project-gamma', session: 'session-ccc', id: 'session-ccc', title: 'Gamma work' },
]

const makeSessionsRoot = ({ compress = false } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-'))
  const root = join(home, 'sessions')
  for (const log of SESSION_LOGS) {
    const lines = sessionLines({ ...log, command: 'pnpm test', errorText: 'command failed with exit code 1' })
    const path = join(root, log.project, log.session, compress ? 'session.jsonl.zstd' : 'session.jsonl')
    if (compress) {
      const frames = lines
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => zstdCompressSync(Buffer.from(`${line}\n`, 'utf8')))
      write(path, Buffer.concat(frames))
    } else write(path, lines)
  }
  return home
}

const reportFrom = async out =>
  JSON.parse(
    await readFile(
      join(
        out,
        readdirSync(out)
          .filter(name => name.startsWith('report-') && name.endsWith('.json'))
          .sort()
          .at(-1),
      ),
      'utf8',
    ),
  )

/**
 * Mirrors the real shape that produced a signal claiming ~630 Sessions of user
 * pushback: DSH splices the opening brief as a peer message, then repeats it as
 * a user message, and appends runtime context as further user messages.
 */
const injectedContextLines = id => {
  const handoff = '# Handoff — the previous attempt is still broken and missing tests, no, do it again'
  return [
    record({ type: 'session', id, createdAt: 1_700_000_000_000, cwd: '/tmp/ws' }),
    record({
      type: 'agent/inbox/spliced',
      seq: 2,
      time: 1_700_000_000_100,
      data: { inserted: [{ role: 'user', content: [{ type: 'text', text: handoff }] }] },
    }),
    record({
      type: 'user/message',
      seq: 3,
      time: 1_700_000_000_200,
      data: { content: [{ type: 'text', text: handoff }], source: { kind: 'user', form: 'message' } },
    }),
    record({ type: 'turn/start', seq: 4, time: 1_700_000_000_300, data: { turn: 1 } }),
    record({ type: 'assistant/message', seq: 5, time: 1_700_000_000_400, data: { message: { source: { provider: 'stub', model: 'stub' } } } }),
    record({
      type: 'tool/call',
      seq: 6,
      time: 1_700_000_000_500,
      data: { turn: 1, step: 1, callId: 'k1', name: 'bash', arguments: JSON.stringify({ command: 'ls' }) },
    }),
    record({
      type: 'tool/result',
      seq: 7,
      time: 1_700_000_000_600,
      data: { message: { role: 'tool', toolCallId: 'k1', isError: false, content: [{ type: 'text', text: 'ok' }] } },
    }),
    record({
      type: 'user/message',
      seq: 8,
      time: 1_700_000_000_700,
      data: {
        content: [{ type: 'text', text: '<system-reminder> more specific instructions take precedence, still do it again </system-reminder>' }],
        source: { kind: 'agent-instructions' },
      },
    }),
    record({
      type: 'user/message',
      seq: 11,
      time: 1_700_000_000_710,
      data: {
        content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier ones, still wrong again' }],
        source: { kind: 'runtime-context' },
      },
    }),
    record({
      type: 'user/message',
      seq: 12,
      time: 1_700_000_000_720,
      data: {
        content: [{ type: 'text', text: 'Background subagent abc finished and will do no further work unless you send it more. It reverted things again' }],
        source: { kind: 'subagent-settled' },
      },
    }),
    record({
      type: 'user/message',
      seq: 13,
      time: 1_700_000_000_730,
      data: { content: [{ type: 'text', text: '<system-reminder> a legacy log with no source field, still wrong again </system-reminder>' }] },
    }),
    record({
      type: 'user/message',
      seq: 9,
      time: 1_700_000_000_800,
      data: { content: [{ type: 'text', text: 'no, that is still wrong — revert that' }], source: { kind: 'user', form: 'message' } },
    }),
    record({ type: 'turn/end', seq: 10, time: 1_700_000_000_900, data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('')
}

const makeInjectedRoot = () => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-injected-'))
  for (const [index, project] of ['project-alpha', 'project-beta', 'project-gamma'].entries()) {
    write(join(home, 'sessions', project, `session-${String(index)}`, 'session.jsonl'), injectedContextLines(`session-${String(index)}`))
  }
  return home
}

test('mining turns repeated failures across Sessions into ranked signals with provenance', async () => {
  const home = makeSessionsRoot()
  const out = join(home, 'report')
  const code = await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true', '--no-cache=true'])
  assert.equal(code, 0)
  const report = await reportFrom(out)
  assert.equal(report.coverage.discovered, 3)
  assert.equal(report.coverage.analyzed, 3)
  assert.equal(report.coverage.totalToolErrors, 3)

  const ids = new Set(report.signals.map(signal => signal.id))
  const toolError = report.signals.find(signal => signal.kind === 'tool-error')
  const repeated = report.signals.find(signal => signal.kind === 'repeated-call')
  const correction = report.signals.find(signal => signal.kind === 'correction')
  assert.ok(toolError, `expected a tool-error signal, got ${[...ids].join(', ')}`)
  assert.equal(toolError.sessions, 3)
  assert.equal(toolError.recurring, true)
  assert.equal(toolError.category, 'tools')
  assert.equal(toolError.evidence[0].sessionId.startsWith('session-'), true)
  assert.equal(toolError.evidence[0].seq > 0, true)
  assert.ok(repeated, 'expected a repeated-call signal')
  assert.equal(repeated.occurrences, 9)
  assert.ok(correction, 'expected a correction signal')
  assert.equal(correction.sessions, 3)
  assert.ok(ids.has('correction:misunderstood-requirement'))
  assert.ok(ids.has('correction:incomplete-or-unfixed'))
  assert.ok(ids.has('jj-failure:status:Error: command failed with exit code <n>'), [...ids].join(', '))
  assert.ok(ids.has('provider-retry:codex:TIMEOUT'))
  assert.ok(ids.has('turn-end:interrupted'))
  assert.ok(report.signals[0].score >= report.signals.at(-1).score)
})

test('injected context and the opening brief are not counted as user pushback', async () => {
  const home = makeInjectedRoot()
  const out = join(home, 'report')
  await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true', '--no-cache=true'])
  const report = await reportFrom(out)

  assert.equal(report.coverage.totalCorrections, 3)
  const corrections = report.signals.filter(signal => signal.kind === 'correction')
  assert.ok(corrections.length > 0, 'the genuine follow-up must still be reported')
  for (const signal of corrections) {
    for (const entry of signal.evidence) assert.equal(entry.seq, 9, `seq ${String(entry.seq)} is not a human message: ${entry.excerpt}`)
  }
  assert.equal(
    report.signals.some(signal => signal.id === 'turn-end:completed'),
    false,
  )
  assert.equal(
    report.signals.some(signal => signal.kind === 'turn-end'),
    false,
  )
})

test('a normal turn ending is never reported as friction', async () => {
  const home = makeInjectedRoot()
  const out = join(home, 'report')
  await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true', '--no-cache=true'])
  const report = await reportFrom(out)
  assert.deepEqual(
    report.signals.filter(signal => signal.id.startsWith('turn-end:')),
    [],
  )
})

test('referencedPaths checks readable paths and ignores routes, build outputs and globs', () => {
  const text = 'Read `~/a/b.md` and `docs/absent.md` but not `dist/index.js`, `/query`, `**/x.ts`, `${DSH_HOME}/y.md` or `README.md`.'
  assert.deepEqual(HarnessAudit.referencedPaths(text).sort(), ['docs/absent.md', '~/a/b.md'])
})

const editLines = ({ id, path, edits }) =>
  [
    record({ type: 'session', id, createdAt: 1_700_000_000_000, cwd: '/tmp/ws' }),
    record({ type: 'session/title', seq: 1, time: 1_700_000_000_100, data: { title: 'editing' } }),
    record({ type: 'turn/start', seq: 2, time: 1_700_000_000_200, data: { turn: 1 } }),
    ...Array.from({ length: edits }, (_unused, index) => [
      record({
        type: 'tool/call',
        seq: 3 + index * 2,
        time: 1_700_000_000_300 + index * 10,
        data: {
          turn: 1,
          step: 1,
          callId: `e${String(index)}`,
          name: 'edit',
          arguments: JSON.stringify({ file_path: path, old_string: `a${String(index)}`, new_string: `b${String(index)}` }),
        },
      }),
      record({
        type: 'tool/result',
        seq: 4 + index * 2,
        time: 1_700_000_000_305 + index * 10,
        data: { message: { role: 'tool', toolCallId: `e${String(index)}`, isError: false, content: [{ type: 'text', text: 'ok' }] } },
      }),
    ]),
    record({ type: 'turn/end', seq: 40, time: 1_700_000_001_000, data: { turn: 1, reason: { kind: 'stop' } } }),
  ]
    .flat()
    .join('')

const makeEditRoot = sessions => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-rework-'))
  sessions.forEach((session, index) => {
    write(
      join(home, 'sessions', `project-${String(index)}`, `session-${String(index)}`, 'session.jsonl'),
      editLines({ id: `session-${String(index)}`, path: session.path, edits: session.edits }),
    )
  })
  return home
}

test('a file reworked in one Session is not a signal; the same file across Sessions is', async () => {
  const oneSession = makeEditRoot([{ path: '/tmp/ws/solo.ts', edits: 5 }])
  const outOne = join(oneSession, 'report')
  await run(['mine', `--dsh-home=${oneSession}`, '--since=all', `--out=${outOne}`, '--quiet=true', '--no-cache=true'])
  const single = await reportFrom(outOne)
  assert.deepEqual(
    single.signals.filter(signal => signal.kind === 'rework'),
    [],
  )

  const repeated = makeEditRoot([
    { path: '/tmp/ws/shared.ts', edits: 4 },
    { path: '/tmp/ws/shared.ts', edits: 4 },
    { path: '/tmp/ws/other.ts', edits: 4 },
  ])
  const outMany = join(repeated, 'report')
  await run(['mine', `--dsh-home=${repeated}`, '--since=all', `--out=${outMany}`, '--quiet=true', '--no-cache=true'])
  const many = await reportFrom(outMany)
  const rework = many.signals.filter(signal => signal.kind === 'rework')
  assert.deepEqual(
    rework.map(signal => signal.id),
    ['rework:/tmp/ws/shared.ts'],
  )
  assert.equal(rework[0].sessions, 2)
})

test('the ledger stores a finding whose evidence is a repository artifact, not a Session', async () => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-artifact-'))
  const path = join(home, 'ledger.jsonl')
  const evidence = [{ time: 1_700_000_000_000, excerpt: 'points at a path that does not exist', ref: 'AGENTS.md' }]
  const outcome = ImprovementLedger.add({
    entries: [],
    input: {
      key: 'instructions.path-missing:x',
      title: 'a dead instruction path',
      category: 'harness',
      confidence: 'high',
      signalIds: [],
      evidence,
      now: 1_700_000_000_000,
    },
  })
  assert.equal(outcome.kind, 'added')
  assert.equal(outcome.entry.evidence[0].ref, 'AGENTS.md')
  assert.match(outcome.entry.history[0].note, /non-Session evidence/)

  await ImprovementLedger.write(path, [outcome.entry])
  const stored = await ImprovementLedger.read(path)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].evidence[0].ref, 'AGENTS.md')
})

test('a second mine reuses the cache instead of re-reading logs', async () => {
  const home = makeSessionsRoot()
  const out = join(home, 'report')
  await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true'])
  const before = await reportFrom(out)
  await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true'])
  const after = await reportFrom(out)
  assert.equal(before.coverage.reusedFromCache, 0)
  assert.equal(after.coverage.reusedFromCache, 3)
  assert.deepEqual(
    after.signals.map(signal => signal.id),
    before.signals.map(signal => signal.id),
  )
})

test('scope filters the report to one category', async () => {
  const home = makeSessionsRoot()
  const out = join(home, 'report')
  await run(['mine', `--dsh-home=${home}`, '--since=all', `--out=${out}`, '--quiet=true', '--no-cache=true', '--scope=infra'])
  const report = await reportFrom(out)
  assert.equal(report.signals.length > 0, true)
  assert.equal(
    report.signals.every(signal => signal.category === 'infra'),
    true,
  )
})

test('the Session log reader follows zstd frames and resumes at a frame boundary', async () => {
  const home = makeSessionsRoot({ compress: true })
  const path = join(home, 'sessions/project-alpha/session-aaa/session.jsonl.zstd')
  const types = []
  for await (const entry of SessionLogs.stream(path)) types.push(entry.type)
  assert.equal(types[0], 'session')
  assert.equal(types.at(-1), 'turn/end')
  assert.equal(types.filter(type => type === 'tool/call').length, 4)
})

test('--since drops Sessions outside the window by log mtime', async () => {
  const home = makeSessionsRoot()
  const past = new Date('2026-01-01T00:00:00Z')
  for (const log of SESSION_LOGS) {
    utimesSync(join(home, 'sessions', log.project, log.session, 'session.jsonl'), past, past)
  }
  const out = join(home, 'report')
  await run(['mine', `--dsh-home=${home}`, '--since=1h', `--out=${out}`, '--quiet=true', '--no-cache=true'])
  const report = await reportFrom(out)
  assert.equal(report.coverage.analyzed, 0)
  assert.equal(report.coverage.skippedBySince, 3)
  assert.deepEqual(report.signals, [])
})

test('parseSince accepts durations and dates and rejects noise', () => {
  assert.equal(SessionLogs.parseSince('all', 1_000), undefined)
  assert.equal(SessionLogs.parseSince('7d', 1_000_000_000), 1_000_000_000 - 7 * 86_400_000)
  assert.equal(SessionLogs.parseSince('30m', 1_000_000), 1_000_000 - 30 * 60_000)
  assert.equal(SessionLogs.parseSince('2026-01-01', Date.parse('2026-02-01')), Date.parse('2026-01-01'))
  assert.throws(() => SessionLogs.parseSince('yesterday', 0))
})

test('errorSignature groups errors that differ only by paths, ids and numbers', () => {
  const left = SessionMiner.errorSignature('Error: exit code 1 at /Users/a/project/src/one.ts:12')
  const right = SessionMiner.errorSignature('Error: exit code 2 at /Users/b/project/src/two.ts:99')
  assert.equal(left, right)
  assert.notEqual(SessionMiner.errorSignature('Error: permission denied'), left)
})

test('identical arguments share a key; different ones do not', () => {
  const first = SessionMiner.callKeys('bash', JSON.stringify({ command: 'jj status' }))
  const second = SessionMiner.callKeys('bash', JSON.stringify({ command: 'jj status' }))
  const third = SessionMiner.callKeys('bash', JSON.stringify({ command: 'jj log' }))
  assert.equal(first.argsKey, second.argsKey)
  assert.notEqual(first.argsKey, third.argsKey)
})

test('correction themes are lexical matches a caller must still read in context', () => {
  assert.deepEqual(SessionMiner.correctionThemes('stop, revert that'), ['unwanted-change', 'stop-and-replan'])
  assert.deepEqual(SessionMiner.correctionThemes('please add a test'), [])
})

test('a follow-up request is not pushback, while a real "still broken" report is', () => {
  // Sampled from the 2026-10-25 review: the loudest "incomplete-or-unfixed" hit was this.
  assert.equal(SessionMiner.correctionThemes('investigate again & confirm everything. ensure this makes sense. then work on the solution.').length, 0)
  assert.equal(SessionMiner.correctionThemes('please run the tests again and then commit').length, 0)
  assert.equal(SessionMiner.correctionThemes('then use a subagent and add the missing field').length, 0)
  assert.ok(SessionMiner.correctionThemes('still broken after the fix').includes('incomplete-or-unfixed'))
  assert.ok(SessionMiner.correctionThemes('you forgot the regression test').includes('incomplete-or-unfixed'))
  assert.ok(SessionMiner.correctionThemes('it fails again with the same error').includes('incomplete-or-unfixed'))
})

test('only the opening of a long brief is scored, so a multi-part plan is not pushback', () => {
  const brief = `1. use a subagent to investigate every competitor then give me an exhaustive list
2. build it again with the missing pieces
3. make sure it still works after the refactor`
  assert.equal(SessionMiner.correctionThemes(brief).length, 0)
})

test('stored excerpts are redacted and capped', () => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'
  assert.equal(SessionMiner.redact(`token ${secret}`).includes(secret), false)
  assert.equal(SessionMiner.redact('password: hunter2hunter2').includes('hunter2'), false)
  assert.equal(SessionMiner.excerptOf(`a${'b'.repeat(500)}`).length, 240)
})

test('the ledger refuses to silently retrack an open or rejected opportunity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-ledger-'))
  const path = join(home, 'plans/self-improve/ledger.jsonl')
  const evidence = { sessionId: 'session-aaa', seq: 5, time: 1_700_000_000_500, excerpt: 'Error: exit code 1' }
  const base = {
    key: 'tool-error:bash:exit <n>',
    title: 'bash fails',
    category: 'tools',
    confidence: 'medium',
    signalIds: ['tool-error:bash:exit <n>'],
    evidence: [evidence],
    now: 1_700_000_000_000,
  }

  const first = ImprovementLedger.add({ entries: [], input: base })
  assert.equal(first.kind, 'added')
  assert.equal(first.entry.evidence.length, 1)

  const duplicate = ImprovementLedger.add({ entries: [first.entry], input: base })
  assert.equal(duplicate.kind, 'duplicate')

  const entries = [first.entry]
  const closed = ImprovementLedger.update({ entries, input: { id: first.entry.id, status: 'rejected', note: 'not reproducible', now: 1_700_000_100_000 } })
  assert.equal(closed.kind, 'updated')

  const refused = ImprovementLedger.add({ entries, input: base })
  assert.equal(refused.kind, 'refused')
  assert.match(refused.reason, /--reopen/)

  const reopened = ImprovementLedger.add({ entries, input: { ...base, reopenReason: 'it recurred 40 times in the last day', now: 1_700_000_200_000 } })
  assert.equal(reopened.kind, 'reopened')
  assert.equal(reopened.entry.attempts, 1)
  assert.equal(reopened.entry.status, 'proposed')
  assert.match(reopened.entry.history.at(-1).note, /reopened/)

  await ImprovementLedger.write(path, entries)
  const roundTripped = await ImprovementLedger.read(path)
  assert.equal(roundTripped.length, 1)
  assert.equal(roundTripped[0].status, 'rejected')
})

test('the ledger drops a stored entry that carries no evidence', async () => {
  const home = mkdtempSync(join(tmpdir(), 'self-improve-ledger-'))
  const path = join(home, 'ledger.jsonl')
  const outcome = ImprovementLedger.add({ entries: [], input: { key: 'k', title: 't', category: 'c', confidence: 'low', signalIds: [], evidence: [], now: 0 } })
  assert.equal(outcome.kind, 'added')
  await ImprovementLedger.write(path, [outcome.entry])
  assert.deepEqual(await ImprovementLedger.read(path), [])
})

test('a link inside a code fence is an example, not a dead link', async () => {
  const root = mkdtempSync(join(tmpdir(), 'self-improve-fence-'))
  write(
    join(root, '.agents/skills/template/SKILL.md'),
    [
      '---',
      'name: template',
      'description: Shows a skill layout. Use when writing one.',
      '---',
      '',
      '```text',
      'my-skill/',
      '├── SKILL.md',
      '├── REFERENCE.md       # detailed docs (if needed)',
      '```',
      '',
      'Then link a real file: [missing](scripts/absent.mjs).',
      '',
    ].join('\n'),
  )
  const report = await HarnessAudit.validate({ root, skillRoots: [join(root, '.agents/skills')], alwaysOnPaths: [] })
  const links = report.findings.filter(finding => finding.code === 'skill.link-missing')
  assert.deepEqual(
    links.map(finding => finding.message),
    ['relative link target `scripts/absent.mjs` does not exist'],
  )
})

test('frontmatter parsing reads the flat skill header DSH accepts', () => {
  const parsed = HarnessAudit.parseFrontmatter('---\nname: demo\ndescription: "Does a thing. Use when needed."\n---\n\nBody')
  assert.equal(parsed.fields.get('name'), 'demo')
  assert.equal(parsed.fields.get('description'), 'Does a thing. Use when needed.')
  assert.match(parsed.body, /Body/)
  assert.equal(HarnessAudit.parseFrontmatter('no frontmatter'), undefined)
})

test('harness validation reports every problem in one pass and passes a clean tree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'self-improve-harness-'))
  write(join(root, '.agents/skills/broken/SKILL.md'), '# no frontmatter\n')
  write(join(root, '.agents/skills/wrong-name/SKILL.md'), '---\nname: other-name\ndescription: Mismatched.\n---\n\nSee [missing](scripts/absent.mjs).\n')
  write(
    join(root, '.agents/skills/private/SKILL.md'),
    '---\nname: private\ndescription: Hidden from the model. Use when hidden.\ndisable-model-invocation: true\n---\n\nBody\n',
  )
  write(join(root, '.agents/skills/good/SKILL.md'), '---\nname: good\ndescription: A valid skill. Use when validating.\n---\n\nBody\n')
  write(join(root, 'AGENTS.md'), '# Instructions\n\nRead `~/definitely/absent/file.md` for preferences.\n')

  const report = await HarnessAudit.validate({ root, skillRoots: [join(root, '.agents/skills')], alwaysOnPaths: [join(root, 'AGENTS.md')] })
  const codes = report.findings.map(finding => finding.code).sort()
  assert.deepEqual(codes, ['instructions.path-missing', 'skill.frontmatter-missing', 'skill.link-missing', 'skill.name-mismatch'])
  assert.match(report.findings.find(finding => finding.code === 'instructions.path-missing').message, /definitely\/absent\/file\.md/)
  assert.equal(report.census.skills.length, 3)
  assert.equal(
    report.census.skills.every(skill => skill.userInvocable),
    true,
  )
  assert.equal(report.census.skills.find(skill => skill.name === 'private').modelInvocable, false)
  assert.equal(report.census.skills.find(skill => skill.name === 'good').modelInvocable, true)

  const clean = mkdtempSync(join(tmpdir(), 'self-improve-clean-'))
  write(join(clean, '.agents/skills/good/SKILL.md'), '---\nname: good\ndescription: A valid skill. Use when validating.\n---\n\nBody\n')
  const cleanReport = await HarnessAudit.validate({ root: clean, skillRoots: [join(clean, '.agents/skills')], alwaysOnPaths: [] })
  assert.deepEqual(cleanReport.findings, [])
})
