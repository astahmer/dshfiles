import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ingest } from '../src/ingest.js'
import { summarize } from '../src/report.js'
import { openStore } from '../src/store.js'

const record = { externalId: 'record-1', title: 'Fictional orchard sensor', observedAt: '2027-04-12T08:00:00Z' }

test('new store has no collected records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sable-smoke-'))
  const store = await openStore({ file: join(directory, 'state.json') })
  assert.equal(store.snapshot().scopes.length, 0)
})

test('one successful terminal page persists across reopen and appears in report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sable-smoke-'))
  const file = join(directory, 'state.json')
  const store = await openStore({ file })
  const result = await ingest({
    store,
    organization: 'org-riverglass',
    provider: 'paperfin',
    fetchPage: async () => ({ status: 200, records: [record], nextPage: 1, done: true }),
    sleep: async () => {},
  })
  assert.equal(result.status, 'complete')
  assert.equal(result.recordCount, 1)
  const reopened = await openStore({ file })
  assert.equal(reopened.scope({ organization: 'org-riverglass', provider: 'paperfin' }).records[0].title, record.title)
  assert.deepEqual(summarize({ snapshot: reopened.snapshot(), organization: 'org-riverglass', provider: 'paperfin' }), {
    organization: 'org-riverglass',
    provider: 'paperfin',
    nextPage: 1,
    recordCount: 1,
    complete: true,
    acquiredPages: 1,
  })
})
