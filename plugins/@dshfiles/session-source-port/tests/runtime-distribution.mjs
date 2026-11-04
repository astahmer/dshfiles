import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSessionSourceRegistry, SessionPayloadError, SessionSources } from '@dshfiles/session-source-port'

// Ordinary Node, not Vite: the Host imports this port through its `./src/index.ts` export, so a `./x.js`
// sibling specifier resolves to nothing at boot even though the bundler and tsc accept it.
test('the session source port loads raw TypeScript with working sibling imports', () => {
  assert.ok(import.meta.resolve('@dshfiles/session-source-port').endsWith('/src/index.ts'))
  assert.equal(SessionSources.key, '@dshfiles/session-source-port/SessionSources')
  assert.equal(new SessionPayloadError({ payload: 'page' })._tag, 'SessionPayloadError')
  const registry = createSessionSourceRegistry()
  const source = { id: 'runtime-a', label: 'Runtime A', list: async () => ({ sessions: [], total: 0 }) }
  registry.register(source)
  assert.deepEqual(registry.sources(), [source])
})
