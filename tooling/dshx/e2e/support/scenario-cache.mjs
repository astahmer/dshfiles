import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'

/**
 * The per-scenario result cache.
 *
 * Turbo already replays a whole owner task whose inputs did not move, but a task covers every scenario its owner's
 * feature files hold, so one bundle that a third of those scenarios never drive still re-runs all of them. This store
 * keys each scenario on what its *own* steps say (`steps`) and on the built JavaScript of every bundle those steps
 * reach (`digests`, the same `.turbo/browser-dist` digests the task itself keys on). Both are content, so a rebase
 * that leaves the files alone keeps its receipts, and a formatting-only edit that keeps a bundle byte-identical keeps
 * them too.
 *
 * The runner computes the current keys, skips the scenarios whose receipt is fresh, and the harness records a receipt
 * for every scenario that actually passed. `DSHX_E2E_SCENARIO_CACHE=0` (what `--force` sets) turns the whole thing off.
 *
 * It is a `.mjs` module on purpose: root `scripts/run-e2e.mjs` is plain Node, while the Playwright harness transpiles
 * TypeScript, and both import this file.
 */

export const scenarioCacheFiles = workspaceRoot => ({
  keys: resolve(workspaceRoot, '.turbo/e2e-scenario-keys.json'),
  receipts: resolve(workspaceRoot, '.turbo/e2e-scenario-receipts.json'),
})

/** The `@scenario:<id>` tag Playwright carries in the test title, which is how the harness names its own scenario. */
export const scenarioIdOf = title => /(?:^|\s|@)scenario:([\w.-]+)/.exec(title)?.[1]

/**
 * Playwright parses `@tag` out of a title into `testInfo.tags`, so the id can live in the tags, the bare title or the
 * full title path depending on the version: read all three rather than guessing which one kept it.
 */
export const scenarioIdOfTest = testInfo => {
  for (const candidate of [...(testInfo.tags ?? []), testInfo.title ?? '', ...(testInfo.titlePath ?? [])]) {
    const id = scenarioIdOf(candidate)
    if (id !== undefined) return id
  }
  return undefined
}

const scenarioKeySchema = z.object({
  id: z.string(),
  steps: z.string(),
  digests: z.record(z.string(), z.string()),
})
const keyStoreSchema = z.record(z.string(), scenarioKeySchema)
const receiptStoreSchema = z.record(z.string(), scenarioKeySchema.extend({ passedAt: z.string().optional() }))

const readStore = async (path, schema) => {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export const readScenarioKeys = workspaceRoot => readStore(scenarioCacheFiles(workspaceRoot).keys, keyStoreSchema)

export const readScenarioReceipts = workspaceRoot => readStore(scenarioCacheFiles(workspaceRoot).receipts, receiptStoreSchema)

/** A receipt proves the same steps against the same built JavaScript; anything else is a miss, never a guess. */
export const receiptIsFresh = (key, receipt) => {
  if (receipt === undefined) return false
  if (receipt.steps !== key.steps) return false
  const names = Object.keys(key.digests).sort()
  const recorded = Object.keys(receipt.digests).sort()
  if (names.length !== recorded.length || names.some((name, index) => name !== recorded[index])) return false
  return names.every(name => receipt.digests[name] === key.digests[name])
}

/** The scenarios a run can replay: keys whose receipt is still fresh. Everything else must run. */
export const replayableScenarioIds = (keys, receipts) =>
  Object.values(keys)
    .filter(key => receiptIsFresh(key, receipts[key.id]))
    .map(key => key.id)

const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`)
  await rename(temporary, path)
}

/** Record what this task's scenarios currently key on, so the harness can store a receipt against the same key. */
export const writeScenarioKeys = async (workspaceRoot, keys) => {
  await writeJson(scenarioCacheFiles(workspaceRoot).keys, keys)
}

/** Remember a scenario that ran and passed, so the next run of unchanged inputs replays it instead of running it. */
export const recordScenarioPass = async ({ workspaceRoot, key, now = Date.now() }) => {
  const known = await readScenarioReceipts(workspaceRoot)
  const next = { ...known, [key.id]: { ...key, passedAt: new Date(now).toISOString() } }
  await writeJson(scenarioCacheFiles(workspaceRoot).receipts, next)
}
