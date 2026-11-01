import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const script = resolve('scripts/effect-schema-codemod.mjs')
const fixture = `import { z } from 'zod'\nexport const schema = z.object({ label: z.string().optional(), active: z.boolean(), jobs: z.array(z.string()), level: z.enum(['low', 'high']), id: z.literal('id'), either: z.union([z.string(), z.number()]), phase: z.discriminatedUnion('phase', [z.object({ phase: z.literal('ready') })]) })\nexport const refined = z.string().refine((value) => value.length > 0)\nexport const superRefined = z.string().superRefine(() => {})\nexport const transformed = z.string().transform((value) => value.length)\nexport const preprocessed = z.preprocess((value) => value, z.string())\nexport const custom = z.custom((value: unknown) => typeof value === 'string')\nexport const passthrough = z.object({ label: z.string() }).passthrough()\n`
const run = args => spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: 'utf8' })

test('check is read-only and write is idempotent with per-file residual JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'effect-schema-codemod-test-'))
  const sourcePath = join(directory, 'input.ts')
  try {
    await writeFile(sourcePath, fixture)
    const checked = run(['--check', directory, '--json'])
    assert.equal(checked.status, 1)
    assert.deepEqual(await readFile(sourcePath, 'utf8'), fixture)

    const firstWrite = run(['--write', directory, '--json'])
    assert.equal(firstWrite.status, 0, firstWrite.stderr)
    const transformed = await readFile(sourcePath, 'utf8')
    assert.match(transformed, /Schema\.Struct\(\{ label: Schema\.optional\(Schema\.String\), active: Schema\.Boolean/)
    assert.match(transformed, /Schema\.Array\(Schema\.String\)/)
    assert.match(transformed, /Schema\.Number\.check\(Schema\.isFinite\(\)\)/)
    assert.match(transformed, /Schema\.Literals\(\['low', 'high'\]\)/)
    assert.match(transformed, /Schema\.Union\(\.\.\.\[Schema\.String, Schema\.Number\.check\(Schema\.isFinite\(\)\)\]\)/)
    assert.match(transformed, /Schema\.Union\(\[Schema\.Struct/)
    assert.match(transformed, /Schema\.Literal\('id'\)/)

    const secondWrite = run(['--write', directory, '--json'])
    assert.equal(secondWrite.status, 0, secondWrite.stderr)
    assert.deepEqual(await readFile(sourcePath, 'utf8'), transformed)
    assert.equal(JSON.parse(secondWrite.stdout).rewrites, 0)
    assert.equal(run(['--check', directory, '--json']).status, 0)

    const residuals = run(['--residuals', directory, '--json'])
    assert.equal(residuals.status, 0, residuals.stderr)
    const report = JSON.parse(residuals.stdout)
    assert.equal(report.residualCount, 6)
    assert.equal(report.filesWithResiduals[0].file.endsWith('input.ts'), true)
    assert.deepEqual(
      report.filesWithResiduals[0].residuals.map(residual => residual.name).sort(),
      ['.passthrough', '.refine', '.superRefine', '.transform', '.preprocess', 'z.custom'].sort(),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
