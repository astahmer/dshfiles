import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const rank = fileURLToPath(new URL('../.agents/skills/first-user-qa/rank.mjs', import.meta.url))

const observation = (persona, frame) => ({ persona, step: 'Open the composer', note: 'The next action was unclear', screenshot: `${persona}-${frame}.png` })

test('ranks normalized findings by distinct personas and preserves every screenshot and note', () => {
  const repeated = [1, 2, 3].map(frame => observation('breaker', frame))
  const shared = [observation('literal', 1), observation('mobile', 1)]
  const findings = [
    { id: 'z-repeat', observations: repeated },
    { id: 'a-other', observations: [observation('careful', 1)] },
    { id: 'shared', observations: shared },
  ]
  const result = spawnSync(process.execPath, [rank], { input: JSON.stringify(findings), encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const ranked = JSON.parse(result.stdout)
  assert.deepEqual(
    ranked.map(({ id, count }) => [id, count]),
    [
      ['shared', 2],
      ['a-other', 1],
      ['z-repeat', 1],
    ],
  )
  assert.deepEqual(ranked[0].observations, shared)
  assert.deepEqual(ranked[2].observations, repeated)
})

test('rejects an unknown persona rather than inflating a count', () => {
  const result = spawnSync(process.execPath, [rank], {
    input: JSON.stringify([{ id: 'shared', observations: [observation('invented', 1)] }]),
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown persona/)
})
