// Run every scenario × arm × repetition through run-arm.mjs, a few at a time on distinct ports.
// Usage: node run-matrix.mjs --out <results-dir> [--scenarios coding,support,logs] [--arms A,B,C] [--reps 2] [--parallel 3] [--base-port 3221]
// Runs whose <runId>.json already exists in --out are skipped, so an interrupted matrix resumes.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const benchRoot = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    scenarios: { type: 'string', default: 'coding,support,logs' },
    arms: { type: 'string', default: 'A,B,C' },
    reps: { type: 'string', default: '2' },
    parallel: { type: 'string', default: '3' },
    'base-port': { type: 'string', default: '3221' },
  },
})
if (values.out === undefined) throw new Error('--out is required')
const out = resolve(values.out)
await mkdir(out, { recursive: true })
const jobs = []
for (let rep = 1; rep <= Number(values.reps); rep++)
  for (const scenario of values.scenarios.split(','))
    for (const arm of values.arms.split(',')) if (!existsSync(join(out, `${scenario}-${arm}-r${rep}.json`))) jobs.push({ scenario, arm, rep })

const freePorts = Array.from({ length: Number(values.parallel) }, (_, index) => Number(values['base-port']) + index)
const runJob = job =>
  new Promise(done => {
    const port = freePorts.shift()
    const child = spawn(
      process.execPath,
      [
        join(benchRoot, 'run-arm.mjs'),
        '--arm',
        job.arm,
        '--scenario',
        join(benchRoot, 'scenarios', `${job.scenario}.json`),
        '--port',
        String(port),
        '--out',
        out,
        '--rep',
        String(job.rep),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    )
    child.on('exit', code => {
      freePorts.push(port)
      done(code)
    })
  })

const queue = [...jobs]
await Promise.all(
  Array.from({ length: Number(values.parallel) }, async () => {
    while (queue.length > 0) await runJob(queue.shift())
  }),
)
console.log(`matrix finished: ${jobs.length} runs`)
