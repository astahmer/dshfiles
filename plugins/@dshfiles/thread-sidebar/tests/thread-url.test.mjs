import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildThreadUrl,
  clearThreadUrl,
  readThreadUrl,
} from '../.test-dist/thread-url.js'

test('copied thread links retain the app path and omit transient credentials and fragments', () => {
  const current = 'http://127.0.0.1:3080/app/?token=private&debug=1#composer'
  const link = buildThreadUrl(current, 'thr_α 7', 'ws_project')
  const parsed = new URL(link)

  assert.equal(parsed.origin, 'http://127.0.0.1:3080')
  assert.equal(parsed.pathname, '/app/')
  assert.equal(parsed.searchParams.get('thread'), 'thr_α 7')
  assert.equal(parsed.searchParams.get('workspace'), 'ws_project')
  assert.equal(parsed.searchParams.has('token'), false)
  assert.equal(parsed.searchParams.has('debug'), false)
  assert.equal(parsed.hash, '')
  assert.deepEqual(readThreadUrl(link), { sessionId: 'thr_α 7', workspaceId: 'ws_project' })
})

test('thread links work without a workspace and stale thread routes can be removed', () => {
  const link = buildThreadUrl('http://localhost:3080/', 'thr_only')
  assert.deepEqual(readThreadUrl(link), { sessionId: 'thr_only' })
  assert.equal(readThreadUrl('http://localhost:3080/'), undefined)
  assert.equal(clearThreadUrl('http://localhost:3080/?thread=old&workspace=project&keep=yes'), 'http://localhost:3080/?keep=yes')
})
