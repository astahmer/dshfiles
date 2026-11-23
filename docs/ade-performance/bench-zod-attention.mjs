// Opt-in only: benchmark the real thread_attention record schema and scratch JSON storage.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import zodPackage from 'zod/package.json' with { type: 'json' }

// Node can strip types; resolve the owner's tsc-style .js specifiers to source for this import only.
const sidebar = new URL('../../plugins/@dshfiles/thread-sidebar/src/', import.meta.url)
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sidebar.href) && specifier.startsWith('./') && specifier.endsWith('.js')) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})
const { threadAttentionDomain } = await import(new URL('attention-store.ts', sidebar))
hook.deregister()
const { DomainFacility } = await import('../../plugins/@dshfiles/storage-domain/src/native/index.ts')
const { JsonStorageBackend } = await import('../../plugins/@dshfiles/storage-json/src/native/index.ts')
const ownerRequire = createRequire(new URL('../../plugins/@dshfiles/storage-domain/package.json', import.meta.url))
const { Context } = await import(ownerRequire.resolve('@deepseek-ai/cordis'))
const { default: Storage } = await import(ownerRequire.resolve('@deepseek-ai/dsh-storage'))

const baseline = threadAttentionDomain.tables.sessions.valueSchema
const reasons = ['completed', 'aborted', 'blocked', 'error', 'max-tokens']
const rows = Array.from({ length: 1024 }, (_, i) => {
  const manual = i % 7 === 0
  return {
    sessionId: `session-synthetic-${i.toString().padStart(4, '0')}`,
    version: 1795000000000 + i,
    finishedAt: manual ? null : 1795000000000 + i,
    finishedSeq: manual ? null : i + 15,
    finishedReason: manual ? null : reasons[i % reasons.length],
    manuallyUnread: manual,
    ...(i % 4 === 0 ? {} : { firstUnreadSeq: manual ? null : i + 10 }),
  }
})
const invalid = rows.slice(0, 64).map(
  (row, i) =>
    [
      { ...row, unknown: true },
      { ...row, finishedSeq: -1 },
      { ...row, finishedReason: '?' },
      { ...row, version: '1' },
    ][i % 4],
)

const compile = () => z.compile(baseline, { strict: true })
const failureOf = operation => {
  try {
    operation()
  } catch (error) {
    return error
  }
  assert.fail('expected validation to fail')
}

async function harness(root) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('json', backend)
  return { backend, facility: new DomainFacility(ctx, { backend: 'json', routes: {} }) }
}

const withSchema = valueSchema => ({
  ...threadAttentionDomain,
  tables: { ...threadAttentionDomain.tables, sessions: { ...threadAttentionDomain.tables.sessions, valueSchema } },
})

const open = async (facility, spec, bad) => {
  const start = performance.now()
  const result = await facility.open(spec).then(
    domain => ({ domain }),
    error => ({ error }),
  )
  const ms = performance.now() - start
  if ('domain' in result) {
    try {
      assert.equal(result.domain.table('sessions').size, rows.length)
      assert.deepEqual(result.domain.table('sessions').get(rows[4].sessionId), rows[4])
      assert.ok(!bad, 'corrupt storage must not open')
    } finally {
      await result.domain.close()
    }
    return { ms }
  }
  if (!bad) throw result.error
  const { code, detail, message, cause } = result.error
  assert.equal(code, 'invalid-record')
  assert.deepEqual(detail, { table: 'sessions', key: invalid[0].sessionId })
  assert.deepEqual(cause.issues, [{ code: 'custom', path: [], message: 'Invalid input' }])
  return { ms, error: { code, detail, message, issues: cause.issues, causeMessage: cause.message } }
}

// Deterministic paired orders: both arms see identical inputs and each runs first equally often.
let state = 111
function shuffle(items) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = Math.floor((state / 2 ** 32) * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
const orders = n => shuffle(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? ['standard', 'compiled'] : ['compiled', 'standard'])))
const report = (name, samples, percent = true) => {
  const stats = values => {
    const sorted = [...values].sort((a, b) => a - b)
    return [0.1, 0.5, 0.9].map(q => sorted[Math.round(q * (sorted.length - 1))].toFixed(3)).join(' / ')
  }
  const change = samples.compiled.map((value, i) => (percent ? (value / samples.standard[i] - 1) * 100 : value - samples.standard[i]))
  console.log(`${name}: standard ${stats(samples.standard)}; compiled ${stats(samples.compiled)}; paired Δ${percent ? '%' : ' ms'} ${stats(change)}`)
}
const paired = async (n, operation) => {
  const samples = { standard: [], compiled: [] }
  for (const order of orders(n)) for (const arm of order) samples[arm].push(await operation(arm))
  return samples
}

const [, , mode, arm] = process.argv
if (mode === '--cold') {
  const start = performance.now()
  const schema = arm === 'compiled' ? compile() : baseline
  const selected = performance.now()
  const result = schema.parse(rows[0])
  const parsed = performance.now()
  assert.deepEqual(result, rows[0])
  console.log(JSON.stringify([selected - start, parsed - selected, parsed - start]))
} else {
  assert.ok(mode === undefined || mode === '--check', 'usage: node --experimental-transform-types docs/ade-performance/bench-zod-attention.mjs [--check]')
  const compiled = compile()
  assert.notEqual(compiled, baseline, 'the candidate must not silently return the input schema')
  for (const row of rows) {
    const original = baseline.parse(row)
    const candidate = compiled.parse(row)
    assert.deepEqual(original, row)
    assert.deepEqual(candidate, original)
    assert.notEqual(original, row)
    assert.notEqual(candidate, row)
  }
  for (const row of [...invalid, null, [], {}]) {
    const original = failureOf(() => baseline.parse(row))
    const candidate = failureOf(() => compiled.parse(row))
    assert.deepEqual(original.issues, [{ code: 'custom', path: [], message: 'Invalid input' }])
    assert.deepEqual(candidate.issues, original.issues)
    assert.equal(candidate.message, original.message)
  }

  const specs = { standard: threadAttentionDomain, compiled: withSchema(compiled) }
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-zod-attention-'))
  try {
    const disks = {}
    for (const variant of ['valid', 'corrupt']) {
      const dir = join(root, variant)
      const table = join(dir, threadAttentionDomain.name, 'sessions')
      await mkdir(table, { recursive: true })
      // Write the on-disk format directly so no candidate can normalize its own fixtures.
      for (const row of rows) {
        const record = variant === 'corrupt' && row.sessionId === invalid[0].sessionId ? invalid[0] : row
        await writeFile(join(table, `${row.sessionId}.json`), JSON.stringify({ version: threadAttentionDomain.version, record }))
      }
      disks[variant] = await harness(dir)
    }
    try {
      const diskOpen = (arm, variant) => open(disks[variant].facility, specs[arm], variant === 'corrupt')
      for (const arm of ['standard', 'compiled']) await diskOpen(arm, 'valid')
      assert.deepEqual((await diskOpen('compiled', 'corrupt')).error, (await diskOpen('standard', 'corrupt')).error)
      console.log(
        `Parity checked: Node ${process.version} ${process.platform}/${process.arch}, Zod ${zodPackage.version}; ${rows.length} valid rows, ${invalid.length + 3} invalid inputs`,
      )

      if (mode !== '--check') {
        console.log('Each result: p10 / median / p90; paired Δ% is compiled vs standard (negative is faster)')
        const cold = await paired(8, name =>
          JSON.parse(
            execFileSync(
              process.execPath,
              ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--cold', name],
              { encoding: 'utf8' },
            ),
          ),
        )
        for (const [i, label] of ['schema selection/compile', 'first valid parse', 'total cold'].entries()) {
          report(`${label} (ms)`, { standard: cold.standard.map(row => row[i]), compiled: cold.compiled.map(row => row[i]) }, false)
        }
        const schemas = { standard: baseline, compiled }
        for (const [label, values, failures] of [
          ['valid', rows, 0],
          ['invalid', invalid, invalid.length],
          ['mixed', [...rows, ...invalid], invalid.length],
        ]) {
          const samples = { standard: [], compiled: [] }
          for (const [i, order] of [...orders(4), ...orders(16)].entries()) {
            const inputs = shuffle(values)
            const repeats = Math.ceil(8192 / inputs.length)
            for (const arm of order) {
              const schema = schemas[arm]
              let rejected = 0
              const start = performance.now()
              for (let repeat = 0; repeat < repeats; repeat++)
                for (const row of inputs) {
                  try {
                    schema.parse(row)
                  } catch {
                    rejected++
                  }
                }
              const us = ((performance.now() - start) * 1000) / (repeats * inputs.length)
              assert.equal(rejected, failures * repeats)
              if (i >= 4) samples[arm].push(us)
            }
          }
          report(`warm parse ${label} (µs/row)`, samples)
        }
        for (const variant of ['valid', 'corrupt']) {
          await paired(4, async arm => (await diskOpen(arm, variant)).ms)
          report(`warm JSON domain open ${variant} (ms/operation)`, await paired(20, async arm => (await diskOpen(arm, variant)).ms))
        }
      }
    } finally {
      await Promise.all(Object.values(disks).map(({ backend }) => backend.close()))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
