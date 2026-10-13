import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const project = process.env.BENCH_PROJECT
if (project === undefined) throw new Error('BENCH_PROJECT must identify the candidate scratch repository')
const load = name => import(pathToFileURL(resolve(project, 'src', name)).href)
const { openStore } = await load('store.js')
const { ingest } = await load('ingest.js')
const { summarize } = await load('report.js')
const selection = { organization: 'org-riverglass', provider: 'paperfin' }
const record = (externalId, title = externalId, observedAt = '2027-04-12T08:00:00Z') => ({ externalId, title, observedAt })
const fresh = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coding-ingestion-acceptance-'))
  const file = join(directory, 'state.json')
  return { directory, file, store: await openStore({ file }) }
}
const commit = ({ store, ...options }) => store.commitPage({ ...selection, page: 0, nextPage: 1, records: [record('item-1')], ...options })
const simulation = ({ store, responses, ...options }) => {
  const requests = []
  const delays = []
  const run = ingest({
    store,
    ...selection,
    fetchPage: async request => {
      requests.push({ page: request.page, attempt: request.attempt, organization: request.organization, provider: request.provider })
      const response = responses.shift()
      if (response instanceof Error) throw response
      assert.ok(response, 'candidate fetched beyond the supplied bounded simulation')
      return response
    },
    sleep: async milliseconds => {
      delays.push(milliseconds)
    },
    ...options,
  })
  return { run, requests, delays }
}

test('candidate project suite stays runnable and release documents corrected behavior', async () => {
  const paths = (await readdir(resolve(project, 'test'))).filter(path => path.endsWith('.test.js')).map(path => resolve(project, 'test', path))
  assert.ok(paths.length > 0, 'candidate must retain real regression tests')
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...paths], {
    cwd: project,
    env: { PATH: process.env.PATH },
    encoding: 'utf8',
    timeout: 60000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(Number(/# pass (\d+)/.exec(result.stdout)?.[1] ?? 0) >= 2)
  const manifest = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.2.0')
  const changelog = (await readFile(resolve(project, 'CHANGELOG.md'), 'utf8')).toLowerCase()
  for (const word of ['0.2.0', 'scope', 'retry', 'partial']) assert.ok(changelog.includes(word), `release notes must cover ${word}`)
})

test('organization isolation survives reopen for overlapping provider identities', async () => {
  const { store, file } = await fresh()
  await commit({ store, records: [record('same-id', 'Riverglass record')] })
  await commit({ store, organization: 'org-driftwood', records: [record('same-id', 'Driftwood record')] })
  const reopened = await openStore({ file })
  assert.equal(reopened.scope(selection).records[0].title, 'Riverglass record')
  assert.equal(reopened.scope({ organization: 'org-driftwood', provider: 'paperfin' }).records[0].title, 'Driftwood record')
  assert.equal(reopened.snapshot().scopes.length, 2)
})

test('provider scope is independent within one organization', async () => {
  const { store } = await fresh()
  await commit({ store })
  await commit({ store, provider: 'reedledger', records: [record('item-1', 'Other provider')] })
  assert.equal(store.scope(selection).records[0].title, 'item-1')
  assert.equal(store.scope({ ...selection, provider: 'reedledger' }).records[0].title, 'Other provider')
})

test('identical page replay is idempotent and a changed replay is refused', async () => {
  const { store, file } = await fresh()
  await commit({ store })
  const before = structuredClone(store.snapshot())
  const bytes = await readFile(file, 'utf8')
  const replay = await commit({ store })
  assert.equal(replay.status, 'replayed')
  assert.deepEqual(store.snapshot(), before)
  assert.equal(await readFile(file, 'utf8'), bytes)
  const reopened = await openStore({ file })
  assert.equal((await commit({ store: reopened })).status, 'replayed')
  assert.equal(await readFile(file, 'utf8'), bytes)
  await assert.rejects(() => commit({ store, records: [record('item-1', 'Changed replay')] }), { code: 'IC_REPLAY_MISMATCH' })
  await assert.rejects(() => commit({ store, done: true }), { code: 'IC_REPLAY_MISMATCH' })
  assert.deepEqual(store.snapshot(), before)
})

test('checkpoint cannot skip or regress a non-replayed page', async () => {
  const { store } = await fresh()
  await assert.rejects(() => commit({ store, page: 4, nextPage: 5 }), { code: 'IC_CHECKPOINT_CONFLICT' })
  await assert.rejects(() => commit({ store, nextPage: 0 }), { code: 'IC_CHECKPOINT_CONFLICT' })
  assert.equal(store.snapshot().revision, 0)
  await commit({ store })
  await assert.rejects(() => commit({ store, page: 1, nextPage: 1 }), { code: 'IC_CHECKPOINT_CONFLICT' })
  assert.equal(store.scope(selection).nextPage, 1)
})

test('invalid records and duplicate identities reject the entire page without checkpoint advancement', async () => {
  const { store } = await fresh()
  const before = structuredClone(store.snapshot())
  await assert.rejects(() => commit({ store, records: [record('valid'), { externalId: 'invalid', title: 'Broken timestamp', observedAt: 'not-a-date' }] }), {
    code: 'IC_INVALID_RECORD',
  })
  await assert.rejects(() => commit({ store, records: [record('same'), record('same')] }), { code: 'IC_DUPLICATE_ID' })
  assert.deepEqual(store.snapshot(), before)
})

test('invalid scope identifiers are rejected rather than normalized into another tenant', async () => {
  const { store } = await fresh()
  for (const organization of ['', ' org-riverglass', '__proto__', 'org/riverglass'])
    await assert.rejects(() => commit({ store, organization }), { code: 'IC_INVALID_SCOPE' })
  assert.equal(store.snapshot().scopes.length, 0)
})

test('scope and snapshot reads are defensive copies and incidental provider fields stay out of canonical rows', async () => {
  const { store } = await fresh()
  await commit({ store, records: [{ ...record('__proto__', 'Legitimate opaque external id'), internalTransport: 'must-not-cross-boundary' }] })
  const scope = store.scope(selection)
  scope.records[0].title = 'Mutated caller copy'
  scope.nextPage = 800
  store.snapshot().scopes.length = 0
  assert.equal(store.scope(selection).nextPage, 1)
  assert.deepEqual(store.scope(selection).records[0], record('__proto__', 'Legitimate opaque external id'))
})

test('stale provider observations never regress canonical content', async () => {
  const { store } = await fresh()
  await commit({ store, records: [record('item-1', 'Newest title', '2027-04-13T08:00:00Z')] })
  await commit({ store, page: 1, nextPage: 2, records: [record('item-1', 'Older title')] })
  assert.equal(store.scope(selection).records[0].title, 'Newest title')
  assert.equal(store.scope(selection).records.length, 1)
  assert.equal(store.scope(selection).nextPage, 2)
  await commit({ store, page: 2, nextPage: 3, records: [record('item-1', 'Equal timestamp must not replace', '2027-04-13T08:00:00Z')] })
  assert.equal(store.scope(selection).records[0].title, 'Newest title')
})

test('filesystem failure leaves in-memory state and checkpoint unchanged', async () => {
  const { store, file } = await fresh()
  const before = structuredClone(store.snapshot())
  await mkdir(file)
  await assert.rejects(() => commit({ store }))
  assert.deepEqual(store.snapshot(), before)
})

test('corrupt persisted state is a visible error and is never silently reset', async () => {
  const { file } = await fresh()
  await writeFile(file, '{broken')
  await assert.rejects(() => openStore({ file }), { code: 'IC_CORRUPT_STATE' })
  assert.equal(await readFile(file, 'utf8'), '{broken')
})

test('invalid persisted snapshot shapes reject visible corruption without rewriting bytes', async () => {
  const { file } = await fresh()
  for (const state of [
    { version: 8, revision: 0, scopes: [] },
    { version: 1, revision: -1, scopes: [] },
    { version: 1, revision: 0, scopes: null },
    { version: 1, revision: 1, scopes: [{ ...selection, nextPage: 1, complete: false, records: [{ externalId: 'bad' }], commits: [] }] },
  ]) {
    const bytes = JSON.stringify(state)
    await writeFile(file, bytes)
    await assert.rejects(() => openStore({ file }), { code: 'IC_CORRUPT_STATE' })
    assert.equal(await readFile(file, 'utf8'), bytes)
  }
})

test('same-process duplicate commits replay once and failed queued work does not poison later valid commits', async () => {
  const { store, file } = await fresh()
  const results = await Promise.all([commit({ store }), commit({ store })])
  assert.deepEqual(results.map(result => result.status).sort(), ['committed', 'replayed'])
  assert.equal(store.snapshot().revision, 1)
  await assert.rejects(() => commit({ store, page: 8, nextPage: 9 }), { code: 'IC_CHECKPOINT_CONFLICT' })
  await commit({ store, page: 1, nextPage: 2, records: [record('item-2')] })
  const reopened = await openStore({ file })
  assert.equal(reopened.scope(selection).records.length, 2)
  assert.equal(reopened.snapshot().revision, 2)
})

test('invalid ingestion bounds reject before provider acquisition', async () => {
  const { store } = await fresh()
  for (const options of [
    { maxPages: 0 },
    { maxPages: 101 },
    { maxPages: 1.5 },
    { maxAttempts: 0 },
    { maxAttempts: 11 },
    { retryMinDelayMs: -1 },
    { retryMinDelayMs: NaN },
  ]) {
    await assert.rejects(
      () =>
        ingest({
          store,
          ...selection,
          fetchPage: async () => {
            assert.fail('invalid options must not fetch')
          },
          sleep: async () => {},
          ...options,
        }),
      { code: 'IC_INVALID_OPTIONS' },
    )
  }
  assert.equal(store.snapshot().revision, 0)
})

test('same-process concurrent commits to different scopes retain both persisted results', async () => {
  const { store, file } = await fresh()
  await Promise.all([commit({ store }), commit({ store, organization: 'org-driftwood', records: [record('item-2')] })])
  const reopened = await openStore({ file })
  assert.equal(reopened.snapshot().scopes.length, 2)
  assert.equal(reopened.snapshot().revision, 2)
  assert.equal(reopened.scope(selection).records.length, 1)
  assert.equal(reopened.scope({ ...selection, organization: 'org-driftwood' }).records.length, 1)
})

test('429 and 503 retry the same page with corrected delay floor and provider retry-after', async () => {
  const { store } = await fresh()
  const simulated = simulation({
    store,
    responses: [
      { status: 429, retryAfterSeconds: 12 },
      { status: 503, retryAfterSeconds: 120 },
      { status: 200, records: [record('item-1')], nextPage: 1, done: true },
    ],
  })
  assert.deepEqual(await simulated.run, { status: 'complete', reason: null, pagesCommitted: 1, recordCount: 1, nextPage: 1 })
  assert.deepEqual(simulated.delays, [90000, 120000])
  assert.deepEqual(
    simulated.requests.map(request => [request.page, request.attempt]),
    [
      [0, 1],
      [0, 2],
      [0, 3],
    ],
  )
  assert.ok(simulated.requests.every(request => request.organization === selection.organization && request.provider === selection.provider))
})

test('four total attempts exhaust without sleeping after the final attempt or erasing partial rows', async () => {
  const { store } = await fresh()
  await commit({ store })
  const before = structuredClone(store.snapshot())
  const simulated = simulation({ store, responses: Array.from({ length: 4 }, () => ({ status: 503 })) })
  assert.deepEqual(await simulated.run, { status: 'partial', reason: 'retry-exhausted', pagesCommitted: 0, recordCount: 1, nextPage: 1 })
  assert.equal(simulated.requests.length, 4)
  assert.deepEqual(simulated.delays, [90000, 90000, 90000])
  assert.deepEqual(store.snapshot(), before)
})

test('transport exceptions are retryable acquisition failures, not successful empty pages', async () => {
  const { store } = await fresh()
  const simulated = simulation({ store, responses: [new Error('simulated connection reset'), { status: 200, records: [], nextPage: 1, done: true }] })
  assert.equal((await simulated.run).status, 'complete')
  assert.deepEqual(simulated.delays, [90000])
  assert.equal(store.scope(selection).commits.length, 1)
})

test('quota exhaustion stops immediately and preserves usable partial results without paid fallback', async () => {
  const { store } = await fresh()
  const simulated = simulation({
    store,
    responses: [
      { status: 200, records: [record('item-1')], nextPage: 1, done: false },
      { status: 429, quotaExhausted: true },
    ],
  })
  assert.deepEqual(await simulated.run, { status: 'partial', reason: 'quota', pagesCommitted: 1, recordCount: 1, nextPage: 1 })
  assert.equal(simulated.requests.length, 2)
  assert.deepEqual(simulated.delays, [])
  assert.equal(store.scope(selection).complete, false)
})

test('permanent provider failures do not retry, persist rows, or claim completion', async () => {
  for (const status of [400, 401, 403]) {
    const { store } = await fresh()
    const simulated = simulation({ store, responses: [{ status, records: [record('must-not-persist')], nextPage: 1, done: true }] })
    assert.deepEqual(await simulated.run, { status: 'partial', reason: 'provider-permanent', pagesCommitted: 0, recordCount: 0, nextPage: 0 })
    assert.equal(simulated.requests.length, 1)
    assert.deepEqual(simulated.delays, [])
    assert.equal(store.snapshot().scopes.length, 0)
  }
})

test('page budget produces partial outcome and a later invocation resumes the committed checkpoint', async () => {
  const { store } = await fresh()
  const first = simulation({ store, maxPages: 1, responses: [{ status: 200, records: [record('item-1')], nextPage: 1, done: false }] })
  assert.deepEqual(await first.run, { status: 'partial', reason: 'page-budget', pagesCommitted: 1, recordCount: 1, nextPage: 1 })
  const second = simulation({ store, responses: [{ status: 200, records: [record('item-2')], nextPage: 2, done: true }] })
  assert.equal((await second.run).recordCount, 2)
  assert.equal(second.requests[0].page, 1)
  const third = simulation({ store, responses: [] })
  assert.equal((await third.run).status, 'complete')
  assert.equal(third.requests.length, 0)
})

test('cancellation before acquisition or after a late response cannot commit new rows', async () => {
  const first = await fresh()
  const controller = new AbortController()
  controller.abort()
  const before = simulation({ store: first.store, signal: controller.signal, responses: [] })
  assert.equal((await before.run).status, 'cancelled')
  assert.equal(before.requests.length, 0)
  const second = await fresh()
  const lateController = new AbortController()
  const result = await ingest({
    store: second.store,
    ...selection,
    signal: lateController.signal,
    fetchPage: async () => {
      lateController.abort()
      return { status: 200, records: [record('late')], nextPage: 1, done: true }
    },
    sleep: async () => {},
  })
  assert.deepEqual(result, { status: 'cancelled', reason: 'aborted', pagesCommitted: 0, recordCount: 0, nextPage: 0 })
  assert.equal(second.store.snapshot().revision, 0)
})

test('cancellation during retry sleep cannot start another request or erase an earlier committed page', async () => {
  const { store } = await fresh()
  await commit({ store })
  const controller = new AbortController()
  let requests = 0
  const result = await ingest({
    store,
    ...selection,
    signal: controller.signal,
    fetchPage: async () => {
      requests += 1
      return { status: 503 }
    },
    sleep: async () => {
      controller.abort()
    },
  })
  assert.deepEqual(result, { status: 'cancelled', reason: 'aborted', pagesCommitted: 0, recordCount: 1, nextPage: 1 })
  assert.equal(requests, 1)
  assert.equal(store.scope(selection).records.length, 1)
})

test('reports reveal only the selected scope and canonical aggregate fields', async () => {
  const { store } = await fresh()
  await commit({ store })
  await commit({ store, organization: 'org-driftwood', records: [record('foreign-1'), record('foreign-2')], done: true })
  assert.deepEqual(summarize({ snapshot: store.snapshot(), ...selection }), { ...selection, nextPage: 1, recordCount: 1, complete: false, acquiredPages: 1 })
  assert.deepEqual(summarize({ snapshot: store.snapshot(), organization: 'org-unseen', provider: 'paperfin' }), {
    organization: 'org-unseen',
    provider: 'paperfin',
    nextPage: 0,
    recordCount: 0,
    complete: false,
    acquiredPages: 0,
  })
})

test('CLI replay exposes truthful partial result and summary after quota exhaustion', async () => {
  const { directory, file } = await fresh()
  const responses = join(directory, 'responses.json')
  await writeFile(
    responses,
    JSON.stringify([
      { status: 200, nextPage: 1, done: false, records: [record('cli-item')] },
      { status: 429, quotaExhausted: true },
    ]),
  )
  const result = spawnSync(
    process.execPath,
    [resolve(project, 'src/cli.js'), '--state', file, '--organization', selection.organization, '--provider', selection.provider, '--responses', responses],
    { cwd: project, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000 },
  )
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.deepEqual(output.result, { status: 'partial', reason: 'quota', pagesCommitted: 1, recordCount: 1, nextPage: 1 })
  assert.deepEqual(output.summary, { ...selection, nextPage: 1, recordCount: 1, complete: false, acquiredPages: 1 })
})
