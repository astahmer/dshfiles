import assert from 'node:assert/strict'
import { scenarioGroundTruth } from './long-scenarios.mjs'

export const assertTaskAcceptance = ({ name, actual }) => {
  const expected = scenarioGroundTruth({ name })
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'handoff must contain exactly the contract fields')
  assert.equal(actual.scenario, name, 'handoff must identify the tested scenario')
  assert.deepEqual(actual.state, expected.state, 'handoff must retain effective decisions, types, and scope')
  assert.deepEqual(actual.actions, expected.actions, 'handoff must obey operational action dependencies')
  assert.deepEqual([...actual.prerequisites].sort(), [...expected.prerequisites].sort(), 'handoff must retain every preflight gate exactly once')
  assert.deepEqual([...actual.rejected].sort(), [...expected.rejected].sort(), 'handoff must explicitly reject unsafe shortcuts')
  assert.deepEqual(actual.rollback, expected.rollback, 'gate failure must preserve durable state')
}
