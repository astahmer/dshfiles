import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { z } from 'zod'
import { completedRun, loadScenario, runtimeFingerprint } from './scenario-loader.mjs'

const benchRoot = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    scenarios: { type: 'string', default: 'infra-rollout,ingestion-incident,product-support' },
    arms: { type: 'string', default: 'A,B,C' },
    reps: { type: 'string', default: '3' },
    parallel: { type: 'string', default: '1' },
    'base-port': { type: 'string', default: '3241' },
    'scenario-dir': { type: 'string', default: join(benchRoot, 'scenarios') },
    variant: { type: 'string', default: 'long' },
    'drain-ms': { type: 'string', default: '120000' },
  },
})
const positiveInteger = z.coerce.number().int().positive()
const config = z
  .object({
    out: z.string().min(1),
    scenarios: z.string().min(1),
    arms: z.string().min(1),
    reps: positiveInteger.max(100),
    parallel: positiveInteger.max(3),
    'base-port': positiveInteger.min(1024).max(65000),
    'scenario-dir': z.string(),
    variant: z.enum(['pilot', 'long']),
    'drain-ms': z.coerce.number().int().nonnegative().max(600000),
  })
  .parse(values)
const arms = z
  .array(z.enum(['A', 'B', 'C']))
  .min(1)
  .parse(config.arms.split(','))
const scenarioNames = z.array(z.string().regex(/^[a-z0-9-]+$/)).parse(config.scenarios.split(','))
if (new Set(arms).size !== arms.length || new Set(scenarioNames).size !== scenarioNames.length) throw new Error('arms and scenarios must be unique')
const out = resolve(config.out)
await mkdir(out, { recursive: true })
const jobs = []
for (let rep = 1; rep <= config.reps; rep++) {
  const rotatedArms = [...arms.slice((rep - 1) % arms.length), ...arms.slice(0, (rep - 1) % arms.length)]
  for (const name of scenarioNames) {
    const modulePath = join(config['scenario-dir'], `${name}.mjs`)
    const path = existsSync(modulePath) ? modulePath : join(config['scenario-dir'], `${name}.json`)
    const { scenario, scenarioHash } = await loadScenario({ path, rep, variant: config.variant })
    for (const arm of rotatedArms) {
      const evidencePath = join(out, `${scenario.name}-${arm}-r${rep}.json`)
      const evidence = await readFile(evidencePath, 'utf8')
        .then(JSON.parse)
        .catch(() => undefined)
      if (
        evidence &&
        completedRun({
          evidence,
          scenarioHash,
          runtimeHash: await runtimeFingerprint({ arm }),
          provider: process.env.BENCH_PROVIDER ?? 'opencode-go-alex',
          model: process.env.BENCH_MODEL ?? 'deepseek-v4.1-flash',
          effort: process.env.BENCH_EFFORT ?? '',
          summaryEffort: process.env.BENCH_SUMMARY_EFFORT ?? '',
        })
      )
        continue
      jobs.push({ path, arm, rep })
    }
  }
}

const freePorts = Array.from({ length: config.parallel }, (_, index) => config['base-port'] + index)
const failures = []
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
        job.path,
        '--port',
        String(port),
        '--out',
        out,
        '--rep',
        String(job.rep),
        '--variant',
        config.variant,
        '--drain-ms',
        String(config['drain-ms']),
      ],
      { stdio: ['ignore', 'inherit', 'inherit'] },
    )
    let settled = false
    const settle = code => {
      if (settled) return
      settled = true
      freePorts.push(port)
      if (code !== 0) failures.push({ ...job, code })
      done()
    }
    child.once('error', error => settle(error.message))
    child.once('exit', code => settle(code))
  })

const queue = [...jobs]
await Promise.all(
  Array.from({ length: config.parallel }, async () => {
    while (queue.length > 0) await runJob(queue.shift())
  }),
)
console.log(`matrix finished: ${jobs.length} attempted, ${failures.length} failed`)
if (failures.length > 0) {
  console.error(JSON.stringify(failures))
  process.exitCode = 1
}
