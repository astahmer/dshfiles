import assert from 'node:assert/strict'
import { test } from 'vitest'
import { frecencyBoosts, recordUse, type FrecencyEntries } from './frecency.js'
import { PaletteRules, type ThreadCandidate } from './palette.js'

const WORDS = ['sidebar', 'footer', 'palette', 'jujutsu', 'migration', 'review', 'refactor', 'billing', 'nix', 'theme']

const syntheticThreads = (count: number): ThreadCandidate[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `thr_${index.toString(36).padStart(6, '0')}`,
    title: `${WORDS[index % WORDS.length]} ${WORDS[(index * 7) % WORDS.length]} task ${index}`,
    project: `project-${index % 40}`,
    cwd: `/Users/dev/code/project-${index % 40}/packages/${WORDS[(index * 3) % WORDS.length]}`,
    updatedAt: 1_700_000_000_000 + index * 1000,
  }))

const syntheticPaths = (count: number): string[] =>
  Array.from(
    { length: count },
    (_, index) => `packages/${WORDS[index % WORDS.length]}/src/${WORDS[(index * 3) % WORDS.length]}/${WORDS[(index * 7) % WORDS.length]}-${index}.ts`,
  )

const syntheticActions = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `command:plugin${index % 25}.${WORDS[index % WORDS.length]}${index}`,
    label: `${WORDS[(index * 3) % WORDS.length]} ${WORDS[(index * 7) % WORDS.length]} command ${index}`,
    aliases: [WORDS[(index * 5) % WORDS.length] ?? '', `alias ${index}`],
  }))

const RUNS_PER_KEYSTROKE = 9

const worstKeystroke = (query: string, rank: (query: string) => void): number => {
  for (let warmup = 0; warmup < 5; warmup++) rank(query)
  let worst = 0
  for (let length = 1; length <= query.length; length++) {
    let fastest = Infinity
    for (let run = 0; run < RUNS_PER_KEYSTROKE; run++) {
      const started = performance.now()
      rank(query.slice(0, length))
      fastest = Math.min(fastest, performance.now() - started)
    }
    worst = Math.max(worst, fastest)
  }
  return worst
}

test('ranking 2,000 threads per keystroke stays within one frame budget', () => {
  const index = PaletteRules.indexThreads(syntheticThreads(2000))
  const worst = worstKeystroke('sidfoo', query => assert.ok(PaletteRules.rankThreads({ index, query, limit: 50 }).length <= 50))
  assert.ok(worst < 8, `worst keystroke ${worst.toFixed(2)}ms exceeds half of a 16 ms frame`)
})

test('ranking 20,000 file paths per keystroke stays within one frame budget', () => {
  const index = PaletteRules.indexFiles(syntheticPaths(20_000))
  const boosts = frecencyBoosts(
    Array.from({ length: 200 }, (_, order) => ({ id: `file:/repo:${syntheticPaths(200)[order] ?? ''}`, count: 3, lastUsedAt: Date.now() })),
    Date.now(),
  )
  const boost = (path: string): number => boosts.get(`file:/repo:${path}`) ?? 0
  const worst = worstKeystroke('palrev', query => assert.ok(PaletteRules.rankFiles({ index, query, limit: 50, boost }).length <= 50))
  assert.ok(worst < 16, `worst keystroke ${worst.toFixed(2)}ms exceeds a 16 ms frame`)
})

test('ranking 500 actions per keystroke stays well inside one frame', () => {
  const actions = syntheticActions(500)
  const worst = worstKeystroke('jujmig', query => PaletteRules.rankActions({ actions, query, boost: () => 0 }))
  assert.ok(worst < 4, `worst keystroke ${worst.toFixed(2)}ms exceeds a quarter of a 16 ms frame`)
})

test('opening the palette prepares 2,000 threads, 20,000 files and 200 frecency entries in under 50 ms', () => {
  const threads = syntheticThreads(2000)
  const paths = syntheticPaths(20_000)
  let frecency: FrecencyEntries = []
  for (let use = 0; use < 200; use++) frecency = recordUse(frecency, `command:${use}`, Date.now())
  let fastest = Infinity
  for (let run = 0; run < RUNS_PER_KEYSTROKE; run++) {
    const started = performance.now()
    const threadIndex = PaletteRules.indexThreads(threads)
    PaletteRules.rankThreads({ index: threadIndex, query: '', limit: 20 })
    const fileIndex = PaletteRules.indexFiles(paths)
    const boosts = frecencyBoosts(frecency, Date.now())
    PaletteRules.rankFiles({ index: fileIndex, query: '', limit: 50, boost: path => boosts.get(path) ?? 0 })
    fastest = Math.min(fastest, performance.now() - started)
  }
  assert.ok(fastest < 50, `fastest open ${fastest.toFixed(2)}ms exceeds the 50 ms open budget`)
})
