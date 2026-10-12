import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * The whole point of this bundle is that it replaces ONE row. A patch that also
 * disabled the session or the session controller would silently drop the jj
 * workspace provisioning this merge exists to preserve, so that is asserted
 * here rather than trusted to review.
 */
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

const disabledIds = [...patch.matchAll(/^- id: (\S+)\n(?:.*\n)*?\s+disabled: true$/gm)].map(match => match[1])
const insertedNames = [...patch.matchAll(/^\s+- id: \S+\n\s+name: '([^']+)'/gm)].map(match => match[1])

test('disables the agent loop and nothing else', () => {
  assert.deepEqual(disabledIds, ['agent-loop'])
})

test('inserts the local bundle as the replacement row', () => {
  assert.deepEqual(insertedNames, ['@dshfiles/dsh-core-agent-loop'])
})

test('never touches the session controller, the session store or persistence', () => {
  for (const protectedRow of ['session', 'session-controller', 'session-persistence-jsonl', 'agent']) {
    assert.ok(!disabledIds.includes(protectedRow), `${protectedRow} must stay native`)
  }
})

test('keeps the row id scoped so it cannot replace an unrelated row', () => {
  assert.match(patch, /id: dshfiles-core-agent-loop/)
})
