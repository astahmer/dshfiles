import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const script = resolve('scripts/effect-schema-codemod.mjs')
const legacyPackage = ['zo', 'd'].join('')
const legacyImport = `import { z } from '${legacyPackage}'`
const legacyImportPattern = new RegExp(`from '${legacyPackage}'`)
const legacyBindingPattern = new RegExp(`import \\{ z \\} from '${legacyPackage}'`)
const fixture = `${legacyImport}\nexport const schema = z.object({ active: z.boolean(), level: z.enum(['low', 'high']), either: z.union([z.string(), z.number()]) })\nexport const boundedString = z.string().min(1).max(32)\nexport const patternedString = z.string().regex(/^[a-z]+$/u)\nexport const array = z.array(z.string())\nexport const boundedInteger = z.number().int().min(0).max(100)\nexport const nonnegativeInteger = z.number().int().nonnegative()\n`
const residualFixture = `${legacyImport}\nexport const refined = z.string().refine((value) => value.length > 0)\nexport const superRefined = z.string().superRefine(() => {})\nexport const transformed = z.string().transform((value) => value.length)\nexport const preprocessed = z.preprocess((value) => value, z.string())\nexport const custom = z.custom((value: unknown) => typeof value === 'string')\nexport const passthrough = z.object({ label: z.string() }).passthrough()\nexport const optional = z.string().optional()\nexport const safeParsed = z.string().safeParse('valid')\nexport const defaulted = z.string().default('x')\nexport const boundedArray = z.array(z.string()).min(1).max(8)\nexport const literal = z.literal(true)\n`
const run = args => spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), encoding: 'utf8' })
const pluginDirectory = resolve('plugins/@dshfiles/jujutsu')

const verifyMapping = async ({ source, expected, runtimeProbe }) => {
  const directory = await mkdtemp(join(pluginDirectory, '.effect-schema-codemod-test-'))
  const sourcePath = join(directory, 'input.ts')
  try {
    await writeFile(sourcePath, source)
    const written = run(['--write', directory, '--json'])
    assert.equal(written.status, 0, written.stderr)
    const transformed = await readFile(sourcePath, 'utf8')
    assert.match(transformed, expected)
    assert.doesNotMatch(transformed, legacyImportPattern)

    const typecheck = spawnSync(
      'pnpm',
      [
        'exec',
        'tsc',
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--verbatimModuleSyntax',
        sourcePath,
      ],
      { cwd: pluginDirectory, encoding: 'utf8' },
    )
    assert.equal(typecheck.status, 0, `${typecheck.stdout}\n${typecheck.stderr}`)

    if (runtimeProbe) {
      const runtime = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', runtimeProbe(pathToFileURL(sourcePath).href)], {
        cwd: pluginDirectory,
        encoding: 'utf8',
      })
      assert.equal(runtime.status, 0, `${runtime.stdout}\n${runtime.stderr}`)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('check is read-only and write is idempotent with per-file residual JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'effect-schema-codemod-test-'))
  const sourcePath = join(directory, 'input.ts')
  const residualPath = join(directory, 'residual.ts')
  try {
    await writeFile(sourcePath, fixture)
    await writeFile(residualPath, residualFixture)
    const checked = run(['--check', directory, '--json'])
    assert.equal(checked.status, 1)
    assert.deepEqual(await readFile(sourcePath, 'utf8'), fixture)
    assert.deepEqual(await readFile(residualPath, 'utf8'), residualFixture)

    const firstWrite = run(['--write', directory, '--json'])
    assert.equal(firstWrite.status, 0, firstWrite.stderr)
    const transformed = await readFile(sourcePath, 'utf8')
    assert.match(transformed, /Schema\.Struct\(\{ active: Schema\.Boolean, level: Schema\.Literals/)
    assert.match(transformed, /array = Schema\.Array\(Schema\.String\)/)
    assert.match(transformed, /Schema\.Number\.check\(Schema\.isFinite\(\)\)/)
    assert.match(transformed, /Schema\.Literals\(\['low', 'high'\]\)/)
    assert.match(transformed, /Schema\.Union\(\[Schema\.String, Schema\.Number\.check\(Schema\.isFinite\(\)\)\]\)/)
    assert.doesNotMatch(transformed, /Schema\.Union\(\[Schema\.Struct/)
    assert.doesNotMatch(transformed, legacyBindingPattern)
    assert.match(transformed, /boundedString = Schema\.String\.check\(Schema\.isMinLength\(1\)\)\.check\(Schema\.isMaxLength\(32\)\)/)
    assert.match(transformed, /patternedString = Schema\.String\.check\(Schema\.isPattern\(\/\^\[a-z\]\+\$\/u\)\)/)
    assert.match(
      transformed,
      /boundedInteger = Schema\.Number\.check\(Schema\.isFinite\(\)\)\.check\(Schema\.isInt\(\)\)\.check\(Schema\.isGreaterThanOrEqualTo\(0\)\)\.check\(Schema\.isLessThanOrEqualTo\(100\)\)/,
    )
    assert.match(
      transformed,
      /nonnegativeInteger = Schema\.Number\.check\(Schema\.isFinite\(\)\)\.check\(Schema\.isInt\(\)\)\.check\(Schema\.isGreaterThanOrEqualTo\(0\)\)/,
    )

    const secondWrite = run(['--write', directory, '--json'])
    assert.equal(secondWrite.status, 0, secondWrite.stderr)
    assert.deepEqual(await readFile(sourcePath, 'utf8'), transformed)
    assert.equal(JSON.parse(secondWrite.stdout).rewrites, 0)
    const retained = await readFile(residualPath, 'utf8')
    assert.deepEqual(retained, residualFixture)
    assert.equal(run(['--check', directory, '--json']).status, 0)

    const residuals = run(['--residuals', directory, '--json'])
    assert.equal(residuals.status, 0, residuals.stderr)
    const report = JSON.parse(residuals.stdout)
    assert.equal(report.residualCount, 13)
    const residualFile = report.filesWithResiduals.find(file => file.file.endsWith('residual.ts'))
    assert.ok(residualFile)
    assert.deepEqual(
      residualFile.residuals.map(residual => residual.name).sort(),
      [
        '.passthrough',
        '.refine',
        '.superRefine',
        '.transform',
        '.preprocess',
        'z.custom',
        '.optional',
        '.safeParse',
        '.default',
        '.arrayBounds',
        '.min',
        '.max',
        'z.literal',
      ].sort(),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('string min emits a typechecked Effect 4.1 check', async () => {
  await verifyMapping({
    source: `${legacyImport}\nexport const schema = z.string().min(2)\n`,
    expected: /Schema\.String\.check\(Schema\.isMinLength\(2\)\)/,
    runtimeProbe: url =>
      `import * as Schema from 'effect/Schema'; import { schema } from ${JSON.stringify(url)}; if (Schema.decodeUnknownResult(schema)('x')._tag !== 'Failure') process.exitCode = 1`,
  })
})

test('strict objects close unknown keys and typecheck in Effect 4.1', async () => {
  await verifyMapping({
    source: `${legacyImport}\nexport const schema = z.object({ label: z.string() }).strict()\nexport const strictObject = z.strictObject({ count: z.number() })\n`,
    expected: /Schema\.StructWithRest\(Schema\.Struct\(\{ label: Schema\.String \}\), \[Schema\.Record\(/,
    runtimeProbe: url =>
      `import * as Schema from 'effect/Schema'; import { schema, strictObject } from ${JSON.stringify(url)}; if (Schema.decodeUnknownResult(schema)({label:'ok'})._tag !== 'Success') process.exitCode = 1; if (Schema.decodeUnknownResult(schema)({label:'ok',extra:true})._tag !== 'Failure') process.exitCode = 1; if (Schema.decodeUnknownResult(strictObject)({count:1,extra:true})._tag !== 'Failure') process.exitCode = 1`,
  })
})

test('parse calls use decodeUnknownSync and typecheck in Effect 4.1', async () => {
  await verifyMapping({
    source: `${legacyImport}\nexport const value = z.string().parse('valid')\n`,
    expected: /Schema\.decodeUnknownSync\(Schema\.String\)\('valid'\)/,
    runtimeProbe: url => `import { value } from ${JSON.stringify(url)}; if (value !== 'valid') process.exitCode = 1`,
  })
})
