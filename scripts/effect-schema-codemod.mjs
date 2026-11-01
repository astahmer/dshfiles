#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const options = new Set(process.argv.slice(2))
const mode = options.has('--write') ? 'write' : options.has('--check') ? 'check' : options.has('--residuals') ? 'residuals' : null
const json = options.has('--json')
const target = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? 'plugins/@dshfiles'
if (!mode || (options.has('--write') && options.has('--check'))) {
  console.error('Usage: node scripts/effect-schema-codemod.mjs (--check|--write|--residuals) [path] [--json]')
  process.exit(2)
}

const supportedExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const walk = async path => {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  if (!entries.length) return supportedExtensions.has(extname(path)) ? [path] : []
  const children = await Promise.all(
    entries
      .filter(entry => !['node_modules', 'dist', '.git', '.jj'].includes(entry.name))
      .map(async entry => {
        const child = resolve(path, entry.name)
        if (entry.isDirectory()) return await walk(child)
        return supportedExtensions.has(extname(entry.name)) ? [child] : []
      }),
  )
  return children.flat()
}

const replacements = [
  ['z.string().min($A)', 'Schema.String.check(Schema.isMinLength($A))'],
  ['z.string().max($A)', 'Schema.String.check(Schema.isMaxLength($A))'],
  ['z.string().regex($A)', 'Schema.String.check(Schema.isPattern($A))'],
  ['z.number().int().min($A)', 'Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo($A))'],
  ['z.number().int().max($A)', 'Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isLessThanOrEqualTo($A))'],
  ['z.number().int().positive()', 'Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0))'],
  ['z.number().int().nonnegative()', 'Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))'],
  ['z.number().min($A)', 'Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo($A))'],
  ['z.number().max($A)', 'Schema.Number.check(Schema.isFinite()).check(Schema.isLessThanOrEqualTo($A))'],
  ['z.number().int()', 'Schema.Number.check(Schema.isFinite()).check(Schema.isInt())'],
  ['z.number().positive()', 'Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThan(0))'],
  ['z.number().nonnegative()', 'Schema.Number.check(Schema.isFinite()).check(Schema.isGreaterThanOrEqualTo(0))'],
  ['z.object($A)', 'Schema.Struct($A)'],
  ['z.string()', 'Schema.String'],
  ['z.number()', 'Schema.Number.check(Schema.isFinite())'],
  ['$A.check(Schema.isMinLength($B)).max($C)', '$A.check(Schema.isMinLength($B)).check(Schema.isMaxLength($C))'],
  ['$A.check(Schema.isMaxLength($B)).min($C)', '$A.check(Schema.isMaxLength($B)).check(Schema.isMinLength($C))'],
  ['$A.check(Schema.isInt()).min($B)', '$A.check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo($B))'],
  ['$A.check(Schema.isInt()).max($B)', '$A.check(Schema.isInt()).check(Schema.isLessThanOrEqualTo($B))'],
  ['$A.check(Schema.isGreaterThanOrEqualTo($B)).max($C)', '$A.check(Schema.isGreaterThanOrEqualTo($B)).check(Schema.isLessThanOrEqualTo($C))'],
  ['$A.check(Schema.isLessThanOrEqualTo($B)).min($C)', '$A.check(Schema.isLessThanOrEqualTo($B)).check(Schema.isGreaterThanOrEqualTo($C))'],
  ['z.boolean()', 'Schema.Boolean'],
  ['z.array($A)', 'Schema.Array($A)'],
  ['z.enum($A)', 'Schema.Literals($A)'],
  ['z.union($A)', 'Schema.Union($A)'],
  ['z.discriminatedUnion($A, $B)', 'Schema.Union($B)'],
  ['z.nullable($A)', 'Schema.NullOr($A)'],
  ['z.describe($A, $B)', 'Schema.annotate({ description: $B })($A)'],
  ['$A.nullable()', 'Schema.NullOr($A)'],
  ['$A.describe($B)', 'Schema.annotate({ description: $B })($A)'],
  ['$A.strict()', 'Schema.StructWithRest($A, [Schema.Record(Schema.String.check(Schema.makeFilter((key) => !Object.hasOwn($A.fields, key))), Schema.Never)])'],
  [
    'z.strictObject($A)',
    'Schema.StructWithRest(Schema.Struct($A), [Schema.Record(Schema.String.check(Schema.makeFilter((key) => !Object.hasOwn($A, key))), Schema.Never)])',
  ],
  ['$A.parse($B)', 'Schema.decodeUnknownSync($A)($B)'],
]
const residualPatterns = [
  ['.refine', '$A.refine($B)', /\.refine\s*\(/],
  ['.superRefine', '$A.superRefine($B)', /\.superRefine\s*\(/],
  ['.transform', '$A.transform($B)', /\.transform\s*\(/],
  ['.safeParse', '$A.safeParse($B)', /\.safeParse\s*\(/],
  ['.catch', '$A.catch($B)', /\.catch\s*\(/],
  ['.optional', '$A.optional()', /\.optional\s*\(/],
  ['z.optional', 'z.optional($A)', /\bz\s*\.\s*optional\s*\(/],
  ['.default', '$A.default($B)', /\.default\s*\(/],
  ['z.default', 'z.default($A, $B)', /\bz\s*\.\s*default\s*\(/],
  ['.arrayBounds', 'z.array($A).min($B)', /\bz\s*\.\s*array\s*\([\s\S]*?\)\s*\.\s*min\s*\(/],
  ['.arrayBounds', 'z.array($A).max($B)', /\bz\s*\.\s*array\s*\([\s\S]*?\)\s*\.\s*max\s*\(/],
  ['z.literal', 'z.literal($A)', /\bz\s*\.\s*literal\s*\(/],
  ['z.infer', 'z.infer<$A>', /\bz\.(?:infer|input|output)\s*</],
  ['.arrayBounds', 'Schema.Array($A).check(Schema.isMinLength($B))', /Schema\.Array\s*\([\s\S]*?\)\s*\.check\(Schema\.isMinLength\(/],
  ['.arrayBounds', 'Schema.Array($A).check(Schema.isMaxLength($B))', /Schema\.Array\s*\([\s\S]*?\)\s*\.check\(Schema\.isMaxLength\(/],
  ['.preprocess', 'z.preprocess($A, $B)', /\bz\s*\.\s*preprocess\s*\(/],
  ['z.custom', 'z.custom($A)', /\bz\s*\.\s*custom\s*\(/],
  ['.passthrough', '$A.passthrough()', /\.passthrough\s*\(/],
  ['z.record', 'z.record($A)', /\bz\s*\.\s*record\s*\(/],
  ['.uuid', '$A.uuid()', /\.uuid\s*\(/],
  ['.url', '$A.url()', /\.url\s*\(/],
  ['.email', '$A.email()', /\.email\s*\(/],
  ['.trim', '$A.trim()', /\.trim\s*\(/],
  ['.nonempty', '$A.nonempty()', /\.nonempty\s*\(/],
  ['.catchall', '$A.catchall($B)', /\.catchall\s*\(/],
  ['.min', '$A.min($B)', /\.min\s*\(/],
  ['.max', '$A.max($B)', /\.max\s*\(/],
  ['.int', '$A.int()', /\.int\s*\(/],
  ['.positive', '$A.positive()', /\.positive\s*\(/],
  ['.nonnegative', '$A.nonnegative()', /\.nonnegative\s*\(/],
  ['.regex', '$A.regex($B)', /\.regex\s*\(/],
  ['.extend', '$A.extend($B)', /\.extend\s*\(/],
  ['.partial', '$A.partial()', /\.partial\s*\(/],
  ['.readonly', '$A.readonly()', /\.readonly\s*\(/],
  ['externalSchema', '', /\b\w+Schema\b/],
]

const blockedPatterns = residualPatterns.filter(
  ([name]) => name !== 'externalSchema' && !['.min', '.max', '.int', '.positive', '.nonnegative', '.regex'].includes(name),
)

const astGrepMatches = (path, pattern, fix = null) => {
  const rule = [
    'id: effect-schema-codemod',
    'language: TypeScript',
    `rule:`,
    `  pattern: '${pattern}'`,
    ...(fix === null ? [] : [`fix: '${fix}'`]),
    'severity: hint',
  ].join('\n')
  const command = ['scan', '--inline-rules', rule, '--json', path]
  const result = spawnSync('ast-grep', command, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `ast-grep failed for ${relative(root, path)}`)
  return JSON.parse(result.stdout)
}

const rewriteSource = async (source, fileName, workdir) => {
  const tempPath = resolve(workdir, basename(fileName))
  await writeFile(tempPath, source)
  const blockedMatches = blockedPatterns.flatMap(([, pattern]) => astGrepMatches(tempPath, pattern)).filter(match => match.text.includes('z.'))
  const outermostBlocked = blockedMatches.filter(
    match =>
      !blockedMatches.some(
        other => other !== match && other.range.byteOffset.start <= match.range.byteOffset.start && other.range.byteOffset.end >= match.range.byteOffset.end,
      ),
  )
  let output = source
  const retainedSchemas = []
  for (const [index, match] of outermostBlocked.sort((left, right) => right.range.byteOffset.start - left.range.byteOffset.start).entries()) {
    const start = Buffer.from(output).subarray(0, match.range.byteOffset.start).toString().length
    const end = Buffer.from(output).subarray(0, match.range.byteOffset.end).toString().length
    const placeholder = `__EFFECT_SCHEMA_CODEMOD_RETAINED_${index}__`
    retainedSchemas.push({ placeholder, source: output.slice(start, end) })
    output = output.slice(0, start) + placeholder + output.slice(end)
  }
  let rewriteCount = 0
  for (const [pattern, fix] of replacements) {
    await writeFile(tempPath, output)
    while (true) {
      await writeFile(tempPath, output)
      const matches = astGrepMatches(tempPath, pattern, fix).filter(
        match => match.text.includes('z.') || match.text.includes('Schema.') || pattern === '$A.extend($B)',
      )
      const outermost = matches.filter(
        match =>
          !matches.some(
            other =>
              other !== match && other.range.byteOffset.start <= match.range.byteOffset.start && other.range.byteOffset.end >= match.range.byteOffset.end,
          ),
      )
      if (!outermost.length) break
      for (const match of outermost.sort((left, right) => right.replacementOffsets.start - left.replacementOffsets.start)) {
        const start = Buffer.from(output).subarray(0, match.replacementOffsets.start).toString().length
        const end = Buffer.from(output).subarray(0, match.replacementOffsets.end).toString().length
        output = output.slice(0, start) + match.replacement + output.slice(end)
        rewriteCount += 1
      }
    }
  }
  for (const retained of retainedSchemas) output = output.replace(retained.placeholder, retained.source)
  if (rewriteCount && /from\s+['"]zod['"]/.test(output) && !/from\s+['"]effect\/Schema['"]/.test(output)) {
    const firstImport = output.match(/^import .*?;?\r?\n/m)?.[0]
    if (firstImport) output = output.replace(firstImport, `${firstImport}import * as Schema from 'effect/Schema'\n`)
  }
  if (rewriteCount && !/\bz\s*\./.test(output)) output = output.replace(/^import\s*\{\s*z\s*\}\s*from\s*['"]zod['"];?\r?\n/m, '')
  return { output, rewriteCount }
}

const countResiduals = (source, file) => {
  const results = []
  for (const imported of source.matchAll(/^\s*import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"];?/gm)) {
    for (const binding of imported[1].split(',')) {
      const importedName = binding
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
      if (importedName.endsWith('Schema')) results.push({ name: 'externalSchema', line: source.slice(0, imported.index).split('\n').length })
    }
  }
  for (const [name, pattern, fastPattern] of residualPatterns) {
    if (name === 'externalSchema' || !fastPattern.test(source)) continue
    for (const match of astGrepMatches(file, pattern).filter(
      match =>
        ['.safeParse', '.catch', '.optional', 'z.optional', '.default', 'z.default', '.arrayBounds'].includes(name) ||
        match.text.includes('z.') ||
        match.text.includes('Schema.'),
    )) {
      results.push({ name, line: match.range.start.line })
    }
  }
  return results
}

const files = await walk(resolve(root, target))
const temporary = await mkdtemp(resolve(tmpdir(), 'effect-schema-codemod-'))
const reports = []
try {
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    if (mode !== 'residuals' && /(?:^|[.-])(test|spec|fixtures?)(?:[.-]|$)/i.test(basename(file))) continue
    if (!/\bz\s*\./.test(source) && mode !== 'residuals') continue
    const { output: candidateOutput, rewriteCount: candidateRewriteCount } = await rewriteSource(source, file, temporary)
    const temporaryFile = resolve(temporary, basename(file))
    await writeFile(temporaryFile, candidateOutput)
    const candidateResiduals = countResiduals(candidateOutput, temporaryFile)
    const rewrittenOutput = candidateResiduals.length ? source : candidateOutput
    const rewrittenCount = candidateResiduals.length ? 0 : candidateRewriteCount
    const residuals = candidateResiduals.length ? countResiduals(source, file) : candidateResiduals
    reports.push({ file: relative(root, file), rewrites: rewrittenCount, pending: rewrittenOutput !== source, residuals })
    if (mode === 'write' && rewrittenOutput !== source) await writeFile(file, rewrittenOutput)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
if (mode === 'residuals') {
  const perFile = reports.map(({ file, residuals }) => ({
    file,
    counts: Object.fromEntries(residualPatterns.map(([name]) => [name, residuals.filter(residual => residual.name === name).length])),
  }))
  const report = {
    files: reports.length,
    residualCount: reports.reduce((count, file) => count + file.residuals.length, 0),
    perFile,
    filesWithResiduals: reports.filter(file => file.residuals.length),
  }
  console.log(
    json
      ? JSON.stringify(report, null, 2)
      : report.filesWithResiduals.map(file => `${file.file}: ${file.residuals.map(residual => `${residual.name}@${residual.line}`).join(', ')}`).join('\n'),
  )
} else {
  const report = {
    files: reports.length,
    rewrites: reports.reduce((count, file) => count + file.rewrites, 0),
    pendingFiles: reports.filter(file => file.pending).map(file => file.file),
  }
  console.log(json ? JSON.stringify({ ...report, perFile: reports }, null, 2) : `${report.rewrites} rewrite(s); ${report.pendingFiles.length} pending file(s)`)
  if (mode === 'check' && report.pendingFiles.length) process.exitCode = 1
}
