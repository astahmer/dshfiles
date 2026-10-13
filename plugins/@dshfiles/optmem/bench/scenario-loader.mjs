import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const expectation = z.union([z.string(), z.array(z.string()).min(1)])
const probeSchema = z.object({
  id: z.string().min(1),
  kind: z.string().optional(),
  expect: z.array(expectation),
  forbid: z.array(expectation).optional(),
})
// The three original long scenarios name their stage and never require tools; the coding lane numbers its stages.
const packetSchema = z.object({
  topic: z.string().min(1),
  stage: z.union([z.number().int().min(1).max(3), z.string().min(1)]),
  rows: z.number().int().positive(),
  requiresTools: z.boolean().default(false),
})
const scenarioSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  fixture: z.string().optional(),
  truth: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  acceptance: z
    .string()
    .regex(/^acceptance\/[a-z0-9-]+\.test\.mjs$/)
    .optional(),
  permissionMode: z.enum(['workspace-write', 'danger-full-access', 'read-only']).optional(),
  turnTimeoutMs: z.number().int().positive().optional(),
  compaction: z.object({ thresholdRatio: z.number().positive().max(1), retainTokens: z.number().int().nonnegative() }).optional(),
  conversations: z
    .array(
      z.object({
        name: z.string().min(1),
        turns: z
          .array(
            z.object({
              prompt: z.string().min(1),
              probe: probeSchema.optional(),
              packet: packetSchema.optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
})

export const loadScenario = async ({ path, rep = 1, variant = 'long' }) => {
  const absolutePath = resolve(path)
  const benchRoot = dirname(fileURLToPath(import.meta.url))
  const source = await readFile(absolutePath, 'utf8')
  const input = absolutePath.endsWith('.mjs') ? await (await import(pathToFileURL(absolutePath).href)).createScenario({ rep, variant }) : JSON.parse(source)
  const scenario = scenarioSchema.parse(input)
  const probes = scenario.conversations.flatMap(conversation => conversation.turns.flatMap(turn => (turn.probe ? [turn.probe.id] : [])))
  if (new Set(probes).size !== probes.length) throw new Error('scenario probe ids must be unique')
  const scenarioIdentity = createHash('sha256').update(JSON.stringify(scenario))
  if (scenario.acceptance !== undefined) scenarioIdentity.update('\u0000acceptance\u0000').update(await readFile(resolve(benchRoot, scenario.acceptance)))
  return {
    scenario,
    scenarioHash: scenarioIdentity.digest('hex'),
    sourceHash: createHash('sha256').update(source).digest('hex'),
    scenarioPath: absolutePath,
  }
}

export const runtimeFingerprint = async ({ arm, calibration = false }) => {
  const benchRoot = dirname(fileURLToPath(import.meta.url))
  const packages = [
    'shared-runtime',
    'ai-accounts',
    ...(arm === 'A' ? [] : ['optmem', 'optmem-core', 'optmem-sqlite']),
    ...(arm === 'C' ? ['request-messages'] : []),
  ]
  const files = [
    ...packages.map(name => resolve(benchRoot, '..', '..', name, 'dist/index.js')),
    resolve(benchRoot, 'probe/index.js'),
    ...(calibration
      ? [resolve(benchRoot, 'calibration-runtime.mjs'), resolve(benchRoot, 'calibration-cases.mjs'), resolve(benchRoot, '..', 'src', 'summarizer.ts')]
      : []),
  ]
  const hash = createHash('sha256')
  for (const path of files) hash.update(await readFile(path))
  return hash.digest('hex')
}

const evidenceSchema = z.object({
  error: z.string().optional(),
  finishedAt: z.string(),
  scenarioHash: z.string(),
  runtimeHash: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.string(),
  summaryEffort: z.string(),
  arm: z.enum(['A', 'B', 'C']),
  expectedTurns: z.number().int().positive(),
  turns: z.array(z.object({ end: z.string() })),
  drain: z.object({ complete: z.boolean() }).optional(),
})

export const completedRun = ({ evidence, scenarioHash, runtimeHash, provider, model, effort, summaryEffort }) => {
  const parsed = evidenceSchema.safeParse(evidence)
  if (!parsed.success) return false
  const run = parsed.data
  return (
    run.error === undefined &&
    run.scenarioHash === scenarioHash &&
    run.runtimeHash === runtimeHash &&
    run.provider === provider &&
    run.model === model &&
    run.effort === effort &&
    run.summaryEffort === summaryEffort &&
    (run.arm === 'A' || run.drain?.complete === true) &&
    run.turns.length === run.expectedTurns &&
    run.turns.every(turn => turn.end === 'completed')
  )
}
