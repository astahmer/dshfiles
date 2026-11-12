import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadWorkload, replay, type EngineSetup, type LoadedSkills, type ReplayResult } from './replay/harness.js'

const GPT_LUNA_MAX_TOKENS = 32_000
/** gpt-6.1-sol's routed output reservation on its 128k window, inferred from the recorded checkpoint sizes. */
const SOL_MAX_TOKENS = 16_384

describe('compaction replay of a recorded thread', () => {
  it('measures each engine setup on the same recorded steps', { timeout: 300_000 }, async () => {
    const workload = loadWorkload('small-context')
    const results: ReplayResult[] = []
    for (const setup of ['A', 'B', 'C'] as const) results.push(await replay({ workload, setup, loadedSkills: 'names', defaultMaxTokens: SOL_MAX_TOKENS }))
    const [current, stockManual, ownedOnly] = results
    if (process.env['COMPACTION_REPLAY_TRACE'] !== undefined) console.log(JSON.stringify(results))
    for (const result of results) {
      expect(result.compactionsSucceeded).toBeGreaterThan(0)
      expect(result.overflows).toBe(0)
    }
    // The owned engine runs first on every step, so the stock automatic row never gets a checkpoint to write.
    expect(current?.checkpointsByStock).toBe(0)
    expect(stockManual?.checkpointsByStock).toBe(0)
    // Only the owned-only setup prunes, through the root pruner row.
    expect(current?.prunedResults).toBe(0)
    expect(ownedOnly?.prunedResults).toBeGreaterThan(0)
    expect(ownedOnly?.survival.every(checkpoint => checkpoint.skillsVisible === checkpoint.skillsLoaded)).toBe(true)
  })
})

/** The full matrix: `COMPACTION_REPLAY=<results.json> vitest run tests/compaction-replay.spec.ts`. */
const output = process.env['COMPACTION_REPLAY']
const repeats = Number(process.env['COMPACTION_REPLAY_REPEATS'] ?? '3')

/** Each recorded thread, with its route's output reservation. */
const SCENARIOS: readonly { readonly fixture: string; readonly defaultMaxTokens: number }[] = [
  { fixture: 'tool-heavy', defaultMaxTokens: GPT_LUNA_MAX_TOKENS },
  { fixture: 'large-results', defaultMaxTokens: GPT_LUNA_MAX_TOKENS },
  { fixture: 'images', defaultMaxTokens: GPT_LUNA_MAX_TOKENS },
  { fixture: 'small-context', defaultMaxTokens: SOL_MAX_TOKENS },
  { fixture: 'skills-subagents', defaultMaxTokens: GPT_LUNA_MAX_TOKENS },
]

const VARIANTS: readonly { readonly setup: EngineSetup; readonly loadedSkills: LoadedSkills }[] = [
  { setup: 'A', loadedSkills: 'off' },
  { setup: 'B', loadedSkills: 'off' },
  { setup: 'C', loadedSkills: 'off' },
  { setup: 'B', loadedSkills: 'names' },
  { setup: 'C', loadedSkills: 'names' },
  { setup: 'D', loadedSkills: 'off' },
  { setup: 'A', loadedSkills: 'names' },
]

describe.runIf(output !== undefined)('compaction replay matrix', () => {
  it('replays every scenario under every setup, alternating setups across repeats', { timeout: 6 * 60 * 60 * 1000 }, async () => {
    const runs: (ReplayResult & { readonly label: string; readonly repeat: number })[] = []
    const only = process.env['COMPACTION_REPLAY_SCENARIOS']?.split(',')
    const scenarios = SCENARIOS.filter(scenario => only === undefined || only.includes(scenario.fixture))
    for (const scenario of scenarios) {
      const workload = loadWorkload(scenario.fixture)
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        // Rotate the order each repeat so no setup always runs first under the same machine load.
        const setups = process.env['COMPACTION_REPLAY_SETUPS']?.split(',')
        const variants = VARIANTS.filter(variant => setups === undefined || setups.includes(`${variant.setup}:${variant.loadedSkills}`))
        const order = variants.map((_, index) => variants[(index + repeat) % variants.length]).filter(variant => variant !== undefined)
        for (const variant of order) {
          const result = await replay({ workload, setup: variant.setup, loadedSkills: variant.loadedSkills, defaultMaxTokens: scenario.defaultMaxTokens })
          runs.push({ ...result, label: scenario.fixture, repeat })
          if (output !== undefined) writeFileSync(output, `${JSON.stringify(runs)}\n`)
        }
      }
    }
    expect(runs.length).toBeGreaterThan(0)
  })
})
