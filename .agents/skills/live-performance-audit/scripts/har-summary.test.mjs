import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildChannelOwners, summarizeHar } from './har-summary.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'har-summary.mjs')
const SECRET = 'launch-token-must-not-leak'
const T0 = Date.parse('2026-11-06T10:00:00.000Z')

const entry = ({ at, url, method = 'POST', body, status = 200, blocked = 0, wait = 5, size = 100 }) => ({
  startedDateTime: new Date(T0 + at).toISOString(),
  time: blocked + wait,
  request: {
    method,
    url,
    headers: [{ name: 'Cookie', value: SECRET }],
    postData: body === undefined ? undefined : { text: JSON.stringify(body) },
  },
  response: { status, bodySize: size, content: { size, text: SECRET } },
  timings: { blocked, wait },
})

const previewChannel = async () => {
  const owners = await buildChannelOwners()
  const found = [...owners.entries()].find(([, owner]) => owner.packageName === '@dshfiles/preview' && owner.apiId === 'preview')
  assert.ok(found, 'the repository map resolves @dshfiles/preview#preview')
  return found[0]
}

const syntheticHar = channel => ({
  log: {
    entries: [
      entry({ at: 0, url: `http://127.0.0.1:1/api/${channel}/devServers`, body: { type: 'call', rpcId: 1, payload: { sessionId: 'a' } }, blocked: 400 }),
      entry({ at: 10, url: `http://127.0.0.1:1/api/${channel}/devServers`, body: { type: 'call', rpcId: 2, payload: { sessionId: 'a' } }, blocked: 300 }),
      entry({ at: 20, url: `http://127.0.0.1:1/api/${channel}/devServers`, body: { type: 'call', rpcId: 3, payload: { sessionId: 'b' } }, blocked: 200 }),
      entry({
        at: 30,
        url: 'http://127.0.0.1:1/api/llm/listProviders',
        body: { type: 'call', rpcId: 4, payload: {} },
        status: 0,
        wait: 0,
        blocked: 15000,
        size: 0,
      }),
      entry({ at: 40, url: `http://127.0.0.1:1/api/changes.summary?token=${SECRET}`, method: 'GET', status: 404, blocked: 100, wait: 3 }),
      entry({ at: 50, url: `http://127.0.0.1:1/?token=${SECRET}`, method: 'GET' }),
    ],
  },
})

test('summarizes queueing, duplicates, aborts and owners of a synthetic HAR', async () => {
  const channel = await previewChannel()
  const summary = summarizeHar({ har: syntheticHar(channel), channelOwners: new Map([[channel, { packageName: '@dshfiles/preview', apiId: 'preview' }]]) })
  assert.equal(summary.requests, 5)
  assert.equal(summary.otherRequests, 1)
  assert.deepEqual(summary.byHttpMethod, { POST: 4, GET: 1 })
  assert.equal(summary.firstSentAfterMs, 140)
  assert.equal(summary.abortedInQueue, 1)
  assert.equal(summary.non2xx, 1)
  assert.deepEqual(summary.duplicates, { extraCalls: 1, withinOneSecond: 1 })
  assert.deepEqual(summary.blockedMs, { p50: 300, p95: 400 })
  const devServers = summary.topMethods.find(row => row.method === 'POST preview/devServers')
  assert.deepEqual(
    { owner: devServers?.owner, calls: devServers?.calls, distinct: devServers?.distinct },
    { owner: '@dshfiles/preview', calls: 3, distinct: 2 },
  )
  assert.equal(summary.topMethods.find(row => row.method === 'POST llm/listProviders')?.owner, 'core')
})

test('reports a channel no repository package × API id hashes to', () => {
  const summary = summarizeHar({ har: syntheticHar('dshx-00000000'), channelOwners: new Map() })
  assert.deepEqual(summary.unmappedChannels, ['unmapped dshx-00000000'])
})

test('the CLI never prints headers, bodies, query strings or the page URL', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'har-summary-'))
  const harPath = path.join(directory, 'synthetic.har')
  fs.writeFileSync(harPath, JSON.stringify(syntheticHar(await previewChannel())))
  for (const flags of [[], ['--json']]) {
    const output = execFileSync(process.execPath, [script, harPath, ...flags], { encoding: 'utf8' })
    assert.ok(output.includes('preview/devServers'))
    assert.ok(!output.includes(SECRET))
    assert.ok(!output.includes('sessionId'))
  }
  fs.rmSync(directory, { recursive: true })
})
