import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batchAnswerBytes, redactHar } from './har-capture.mjs'

const entry = (body, url) => ({
  startedDateTime: '2026-11-06T10:00:00.000Z',
  time: 12,
  timings: { blocked: 1, wait: 10 },
  request: {
    method: 'POST',
    url,
    httpVersion: 'HTTP/1.1',
    headers: [{ name: 'cookie', value: 'session=secret-cookie' }],
    cookies: [{ name: 'session', value: 'secret-cookie' }],
    queryString: [{ name: 'token', value: 'secret-token' }],
    bodySize: body.length,
    postData: { mimeType: 'application/json', text: body },
  },
  response: {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    headers: [{ name: 'set-cookie', value: 'session=secret-cookie' }],
    cookies: [],
    content: { size: 42, mimeType: 'application/json', text: '{"thread":"private text"}' },
    redirectURL: '',
    bodySize: 42,
  },
})

test('redaction keeps timings, sizes and duplicate digests but no credential or content', () => {
  const har = {
    log: {
      pages: [{ title: 'private title' }],
      entries: [
        entry('{"rpcId":1,"method":"session/page","params":{"note":"private text"}}', 'http://127.0.0.1:3080/api/remote/session/page?token=secret-token'),
        entry('{"rpcId":2,"method":"session/page","params":{"note":"private text"}}', 'http://127.0.0.1:3080/api/remote/session/page?token=secret-token'),
      ],
    },
  }
  const redacted = redactHar(har)
  const text = JSON.stringify(redacted)
  for (const secret of ['secret-token', 'secret-cookie', 'private text', 'private title']) assert.equal(text.includes(secret), false, secret)
  const [first, second] = redacted.log.entries
  assert.equal(first.request.postData.text, second.request.postData.text)
  assert.equal(first.request.postData._bodyBytes > 0, true)
  assert.deepEqual(first.timings, { blocked: 1, wait: 10 })
  assert.equal(first.response.content.size, 42)
  assert.equal(new URL(first.request.url).pathname, '/api/remote/session/page')
})

test('a batch POST keeps each call endpoint, payload digest and answer size, never the payload', () => {
  const body = id =>
    JSON.stringify({
      entries: [
        { id, endpoint: 'dshx-abc123/state', payload: { version: 1, input: { note: 'private text' }, traceparent: `00-${'1'.repeat(31)}${id}-${'2'.repeat(16)}-01` } },
        { id: id + 1, endpoint: 'dshx-def456/list', payload: { version: 1, input: {} } },
      ],
    })
  const first = body(1)
  const second = body(3)
  const answered = entry(first, 'http://127.0.0.1:3080/api/dshx-batch')
  answered.response.content = { size: 120, mimeType: 'application/x-ndjson', text: `{"id":2,"result":{"ok":true,"value":"private text"}}\n{"id":1,"status":503}\n` }
  const redacted = redactHar({ log: { entries: [answered, entry(second, 'http://127.0.0.1:3080/api/dshx-batch')] } })
  assert.equal(JSON.stringify(redacted).includes('private text'), false)
  const [one, two] = redacted.log.entries.map(item => item.request.postData._batch)
  assert.deepEqual(
    one.map(call => [call.endpoint, call.responseBytes]),
    [
      ['dshx-abc123/state', 22],
      ['dshx-def456/list', 53],
    ],
  )
  assert.equal(one[0].digest, two[0].digest, 'traceparent and call id do not split identical reads')
  assert.equal(two[0].responseBytes, null)
})

test('batchAnswerBytes measures each NDJSON line by call id and skips a cut line', () => {
  assert.deepEqual(batchAnswerBytes('{"id":4,"result":{"ok":true,"value":1}}\n{"id":5,"status":404}\n{"id":6,"res'), { 4: 40, 5: 22 })
})
