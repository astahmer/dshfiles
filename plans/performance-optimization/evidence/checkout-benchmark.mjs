import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv[2] === undefined) throw new Error('Usage: checkout-benchmark.mjs <built-checkout-root> [output.json]')
const repositoryRoot = resolve(process.argv[2])

const originalRead = fs.readFileSync
let mapReads = 0
let mapBytes = 0
fs.readFileSync = (...arguments_) => {
  const result = originalRead(...arguments_)
  if (String(arguments_[0]).endsWith('.js.map')) {
    mapReads += 1
    mapBytes += Buffer.byteLength(result)
  }
  return result
}
syncBuiltinESMExports()
const implementation = resolve(repositoryRoot, 'tooling/dshx/packages/dshx/dist/checkout/rebuild.js')
const { CheckoutRebuild } = await import(pathToFileURL(implementation).href)
const samples = []
for (let iteration = 0; iteration < 6; iteration += 1) {
  mapReads = 0
  mapBytes = 0
  const started = performance.now()
  const plan = CheckoutRebuild.plan({ root: repositoryRoot, changedFiles: [] })
  const elapsedMs = performance.now() - started
  samples.push({ iteration, elapsedMs, mapReads, mapBytes, selectedPlugins: plan.plugins.length })
}
const report = {
  recordedAt: new Date().toISOString(),
  kind: 'read-only-checkout-planner-no-changed-files',
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  implementation,
  samples,
  p50WarmMs: [...samples.slice(1).map(sample => sample.elapsedMs)].sort((left, right) => left - right)[2],
}
if (process.argv[3] !== undefined) fs.writeFileSync(resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
