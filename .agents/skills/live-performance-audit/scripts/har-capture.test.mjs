import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactHar } from './har-capture.mjs'

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
