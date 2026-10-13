import assert from 'node:assert/strict'
import { scenarioGroundTruth } from './long-scenarios.mjs'

export const taskAcceptanceChecks = [
  {
    id: 'contains exactly the contract fields',
    assert: ({ actual, expected }) =>
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'handoff must contain exactly the contract fields'),
  },
  {
    id: 'identifies the tested scenario',
    assert: ({ name, actual }) => assert.equal(actual.scenario, name, 'handoff must identify the tested scenario'),
  },
  {
    id: 'retains effective decisions, types, and scope',
    assert: ({ actual, expected }) =>
      assert.deepEqual(actual.state, expected.state, 'handoff must retain effective decisions, types, and scope'),
  },
  {
    id: 'obeys operational action dependencies',
    assert: ({ actual, expected }) => assert.deepEqual(actual.actions, expected.actions, 'handoff must obey operational action dependencies'),
  },
  {
    id: 'retains every preflight gate exactly once',
    assert: ({ actual, expected }) =>
      assert.deepEqual([...actual.prerequisites].sort(), [...expected.prerequisites].sort(), 'handoff must retain every preflight gate exactly once'),
  },
  {
    id: 'explicitly rejects unsafe shortcuts',
    assert: ({ actual, expected }) =>
      assert.deepEqual([...actual.rejected].sort(), [...expected.rejected].sort(), 'handoff must explicitly reject unsafe shortcuts'),
  },
  {
    id: 'preserves durable state on gate failure',
    assert: ({ actual, expected }) => assert.deepEqual(actual.rollback, expected.rollback, 'gate failure must preserve durable state'),
  },
]

export const assertTaskAcceptance = ({ name, actual }) => {
  const expected = scenarioGroundTruth({ name })
  for (const check of taskAcceptanceChecks) check.assert({ name, actual, expected })
}
