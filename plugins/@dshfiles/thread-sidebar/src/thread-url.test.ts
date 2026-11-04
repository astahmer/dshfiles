import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PageLoadThreadRoute, ThreadUrlModel } from './thread-url.js'

test('copied thread links retain the app path and omit transient credentials and fragments', () => {
  const current = 'http://127.0.0.1:3080/app/?token=private&debug=1#composer'
  const link = ThreadUrlModel.buildThreadUrl(current, 'thr_α 7', 'ws_project')
  const parsed = new URL(link)

  assert.equal(parsed.origin, 'http://127.0.0.1:3080')
  assert.equal(parsed.pathname, '/app/')
  assert.equal(parsed.searchParams.get('thread'), 'thr_α 7')
  assert.equal(parsed.searchParams.get('workspace'), 'ws_project')
  assert.equal(parsed.searchParams.has('token'), false)
  assert.equal(parsed.searchParams.has('debug'), false)
  assert.equal(parsed.hash, '')
  assert.deepEqual(ThreadUrlModel.readThreadUrl(link), { sessionId: 'thr_α 7', workspaceId: 'ws_project' })
})

test('thread links work without a workspace and stale thread routes can be removed', () => {
  const link = ThreadUrlModel.buildThreadUrl('http://localhost:3080/', 'thr_only')
  assert.deepEqual(ThreadUrlModel.readThreadUrl(link), { sessionId: 'thr_only' })
  assert.equal(ThreadUrlModel.readThreadUrl('http://localhost:3080/'), undefined)
  assert.equal(ThreadUrlModel.clearThreadUrl('http://localhost:3080/?thread=old&workspace=project&keep=yes'), 'http://localhost:3080/?keep=yes')
})

test('the page-load thread route is offered until a list resolves it, never to a later remount', () => {
  const route = new PageLoadThreadRoute()
  const loaded = 'http://localhost:3080/?thread=thr_linked'
  // A list that unmounts before the Host list is ready leaves the route for the next mount.
  assert.equal(route.pending(loaded), 'thr_linked')
  assert.equal(route.pending(loaded), 'thr_linked')
  route.settle()
  // The rail brings the list back while the URL still names the thread it last wrote: not a navigation.
  assert.equal(route.pending('http://localhost:3080/?thread=thr_stale'), null)
})

test('a page loaded without a thread route never treats a URL written later as one', () => {
  const route = new PageLoadThreadRoute()
  assert.equal(route.pending('http://localhost:3080/'), null)
  assert.equal(route.pending('http://localhost:3080/?thread=thr_written_by_the_list'), null)
})
