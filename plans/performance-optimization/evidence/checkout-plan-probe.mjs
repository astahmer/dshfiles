import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Counts what the checkout planner really opens. Pass a separately built implementation root so the
 * same target checkout can be measured before and after a compiler change. Nothing is written.
 *
 *   node checkout-plan-probe.mjs <implementation-root> <target-root> [changed-file...]
 */
const [implementationRoot, targetRoot, ...changedFiles] = process.argv.slice(2)
if (implementationRoot === undefined || targetRoot === undefined)
  throw new Error('Usage: checkout-plan-probe.mjs <implementation-root> <target-root> [changed-file...]')

const originalRead = fs.readFileSync
let mapReads = 0
let mapBytes = 0
let manifestReads = 0
let manifestBytes = 0
fs.readFileSync = (...arguments_) => {
  const result = originalRead(...arguments_)
  const path = String(arguments_[0])
  if (path.endsWith('.js.map')) {
    mapReads += 1
    mapBytes += Buffer.byteLength(result)
  }
  if (path.endsWith('.deps.json')) {
    manifestReads += 1
    manifestBytes += Buffer.byteLength(result)
  }
  return result
}
syncBuiltinESMExports()

const implementation = resolve(implementationRoot, 'tooling/dshx/packages/dshx/dist/checkout/rebuild.js')
const { CheckoutRebuild } = await import(pathToFileURL(implementation).href)
const root = resolve(targetRoot)

const run = () => {
  mapReads = 0
  mapBytes = 0
  manifestReads = 0
  manifestBytes = 0
  const started = performance.now()
  const plan = CheckoutRebuild.plan({ root, changedFiles })
  return {
    elapsedMs: Number((performance.now() - started).toFixed(2)),
    mapReads,
    mapBytes,
    manifestReads,
    manifestBytes,
    selectedPlugins: plan.plugins.length,
    selection: plan.plugins.map(entry => `${entry.name}:${entry.host ? 'host' : '-'}${entry.client ? 'client' : '-'}`).sort(),
  }
}

const samples = [run(), run(), run(), run()]
console.log(
  JSON.stringify(
    {
      kind: 'checkout-planner-probe',
      implementation,
      targetRoot: root,
      changedFiles,
      samples: samples.map(sample => ({ ...sample, selection: undefined })),
      selection: samples[0]?.selection,
    },
    null,
    2,
  ),
)
