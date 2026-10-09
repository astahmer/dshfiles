import assert from 'node:assert/strict'
import { test } from 'vitest'
import { indexThreads, rankThreads, type ThreadCandidate } from './palette.js'

const WORDS = ['sidebar', 'footer', 'palette', 'jujutsu', 'migration', 'review', 'refactor', 'billing', 'nix', 'theme']

const syntheticThreads = (count: number): ThreadCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `thr_${index.toString(36).padStart(6, '0')}`,
    title: `${WORDS[index % WORDS.length]} ${WORDS[(index * 7) % WORDS.length]} task ${index}`,
    project: `project-${index % 40}`,
    cwd: `/Users/dev/code/project-${index % 40}/packages/${WORDS[(index * 3) % WORDS.length]}`,
    updatedAt: 1_700_000_000_000 + index * 1000,
  }))

test('ranking 2,000 threads per keystroke stays within one frame budget', () => {
  const index = indexThreads(syntheticThreads(2000))
  const query = 'sidfoo'
  for (let warmup = 0; warmup < 5; warmup++) rankThreads({ index, query, limit: 50 })
  const durations: number[] = []
  for (let length = 1; length <= query.length; length++) {
    for (let run = 0; run < 5; run++) {
      const started = performance.now()
      const ranked = rankThreads({ index, query: query.slice(0, length), limit: 50 })
      durations.push(performance.now() - started)
      assert.ok(ranked.length <= 50)
    }
  }
  durations.sort((left, right) => left - right)
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? Infinity
  assert.ok(p95 < 8, `p95 ${p95.toFixed(2)}ms exceeds half of a 16 ms frame`)
})
