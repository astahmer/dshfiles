import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const script = resolve('scripts/effect-native-audit.mjs')

const hostSource = `import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { Effect, Layer, Schema } from 'effect'
import { loadStore } from './store.js'
import { helper } from 'some-library'

let counter = 0
const runtimes = new WeakMap<Context, number>()

class StoreError extends Schema.TaggedError<StoreError>()('StoreError', { message: Schema.String }) {}
class ReadError extends Schema.TaggedError<ReadError>()('ReadError', { cause: Schema.optional(Schema.Defect()) }) {}
class StoreService extends Context.Service<StoreService, {}>()('@dshfiles/alpha/StoreService') {}

export const plugin = DshxEffect.plugin({ layer: Layer.empty })
export const load = Effect.tryPromise({ try: () => loadStore(), catch: cause => new ReadError({ cause }) })
export const external = Effect.tryPromise({ try: () => helper(), catch: cause => new ReadError({ cause }) })
export const remote = Effect.promise(() => fetch('https://example.test'))
export const decode = Effect.gen(function* () {
  return Schema.decodeUnknownSync(Schema.String)(yield* load)
})
// setTimeout(() => undefined, 1) is only a comment
setTimeout(() => undefined, 1)
Effect.runPromise(load)
spawn('jj')
readFile('x')
`

const fixture = {
  'plugins/@dshfiles/alpha/dshx.config.ts': "export default defineConfig({ host: { entry: 'src/host.ts' }, client: { entry: 'src/client.tsx' } })\n",
  'plugins/@dshfiles/alpha/src/host.ts': hostSource,
  'plugins/@dshfiles/alpha/src/store.ts': 'export const loadStore = async () => 1\n',
  'plugins/@dshfiles/alpha/src/client.tsx': "import { useState } from 'react'\nsetInterval(() => undefined, 1)\nexport const view = useState\n",
  'plugins/@dshfiles/alpha/src/widget.ts': 'let clientOnly = 0\nsetTimeout(() => clientOnly++, 1)\n',
  'plugins/@dshfiles/alpha/src/native/vendored.ts': 'let vendored = 0\n',
  'plugins/@dshfiles/alpha/src/store.test.ts':
    "import { it } from '@effect/vitest'\nimport { vi } from 'vitest'\nimport { loadStore } from './store.js'\nvi.mock('node:fs')\nvi.useFakeTimers()\nit('loads', () => loadStore())\n",
  'plugins/@dshfiles/alpha/src/widget.test.ts': "import { vi } from 'vitest'\nimport './widget.js'\nvi.fn()\n",
  'plugins/@dshfiles/beta/dshx.config.ts': "export default defineConfig({ host: { entry: 'src/host.ts' } })\n",
  'plugins/@dshfiles/beta/src/host.ts': "import { Effect } from 'effect'\nexport const value = Effect.succeed(1)\n",
}

const withFixture = async run => {
  const root = await mkdtemp(join(tmpdir(), 'effect-native-audit-'))
  try {
    for (const [path, content] of Object.entries(fixture)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), content)
    }
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const audit = (root, ...args) =>
  spawnSync(process.execPath, [script, `--root=${root}`, `--baseline=${join(root, 'baseline.json')}`, ...args], { encoding: 'utf8' })

test('scores only Host files reachable from the host entry and tests that exercise them', () =>
  withFixture(async root => {
    assert.equal(audit(root, '--update').status, 0)
    const result = audit(root, '--json')
    assert.equal(result.status, 0, result.stderr)
    const alpha = JSON.parse(result.stdout).plugins.find(row => row.plugin === '@dshfiles/alpha')
    assert.deepEqual(alpha.metrics, {
      layerEmpty: 1,
      promiseAdapters: 1,
      moduleState: 2,
      timers: 1,
      childProcess: 1,
      nodeFs: 1,
      globalFetch: 1,
      causelessErrors: 1,
      testMocks: 2,
      runOutsideEdges: 1,
      syncDecodeInEffect: 1,
      taggedErrors: 2,
      effectVitestFiles: 1,
      services: 1,
    })
    assert.equal(alpha.hostFileCount, 2)
    assert.equal(alpha.score, 13)
    const beta = JSON.parse(result.stdout).plugins.find(row => row.plugin === '@dshfiles/beta')
    assert.equal(beta.score, 0)
  }))

test('prints a table with a total row', () =>
  withFixture(async root => {
    audit(root, '--update')
    const result = audit(root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /\| @dshfiles\/alpha +\| +13 \|/u)
    assert.match(result.stdout, /\| TOTAL +\| +13 \|/u)
  }))

test('fails when a metric grows past the baseline and passes again once it improves', () =>
  withFixture(async root => {
    audit(root, '--update')
    const hostPath = join(root, 'plugins/@dshfiles/beta/src/host.ts')
    await writeFile(hostPath, `${await readFile(hostPath, 'utf8')}setInterval(() => undefined, 1)\n`)
    const regressed = audit(root)
    assert.equal(regressed.status, 1)
    assert.match(regressed.stderr, /@dshfiles\/beta timers: 1 \(baseline 0\)/u)

    await writeFile(hostPath, "import { Effect } from 'effect'\n")
    const improved = audit(root)
    assert.equal(improved.status, 0, improved.stderr)
  }))

test('requires a recorded baseline', () =>
  withFixture(async root => {
    const result = audit(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--update/u)
  }))
