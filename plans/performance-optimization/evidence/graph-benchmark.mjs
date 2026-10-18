import { performance } from 'node:perf_hooks'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { RevisionGraphModel } = await import(pathToFileURL(resolve(repositoryRoot, 'plugins/@dshfiles/jujutsu/src/graph.ts')).href)

const chain = ({ prefix, count, base, trunk }) => Array.from({ length: count }, (_, index) => ({
  commitId: `${prefix}${index}`,
  parents: index + 1 < count ? [`${prefix}${index + 1}`] : base === undefined ? [] : [base],
  shortestChangeId: `${prefix}${index}`,
  immutable: false,
  bookmarks: trunk && index === 0 ? ['main'] : [],
}))
const fixture = ({ count, shape }) => {
  if (shape === 'linear') return chain({ prefix: 'main', count, trunk: true })
  const trunkCount = Math.floor(count / 5)
  const trunk = chain({ prefix: 'main', count: trunkCount, trunk: true })
  const branches = Array.from({ length: Math.floor((count - trunkCount) / 8) }, (_, index) => chain({ prefix: `branch-${index}-`, count: 8, base: `main${Math.min(index % trunkCount, trunkCount - 1)}` })).flat()
  return [...branches, ...trunk]
}
const percentile = ({ samples, fraction }) => [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * fraction) - 1]
const results = []
for (const shape of ['linear', 'branchy']) {
  for (const count of [100, 500, 1000, 2000]) {
    const revisions = fixture({ count, shape })
    const byId = new Map(revisions.map(revision => [revision.commitId, revision]))
    const samples = []
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const started = performance.now()
      const rows = RevisionGraphModel.layoutRevisionGraph(revisions, byId, false)
      const elapsed = performance.now() - started
      if (rows.length !== revisions.length || new Set(rows.map(row => row.commitId)).size !== revisions.length) throw new Error('Incomplete layout')
      if (iteration > 0) samples.push(elapsed)
    }
    results.push({ shape, revisions: revisions.length, warmup: 1, count: samples.length, samplesMs: samples, p50Ms: percentile({ samples, fraction: 0.5 }), maxMs: Math.max(...samples) })
  }
}
const report = { recordedAt: new Date().toISOString(), kind: 'synthetic-pure-algorithm-not-browser', node: process.version, platform: process.platform, architecture: process.arch, results }
if (process.argv[2] !== undefined) await writeFile(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
