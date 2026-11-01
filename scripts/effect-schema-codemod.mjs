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
  ['z.object($A)', 'Schema.Struct($A)'],
  ['z.string()', 'Schema.String'],
  ['z.number()', 'Schema.Number.check(Schema.isFinite())'],
  ['z.boolean()', 'Schema.Boolean'],
  ['z.array($A)', 'Schema.Array($A)'],
  ['z.enum($A)', 'Schema.Literals($A)'],
  ['z.literal($A)', 'Schema.Literal($A)'],
  ['z.union($A)', 'Schema.Union(...$A)'],
  ['z.discriminatedUnion($A, $B)', 'Schema.Union($B)'],
  ['z.optional($A)', 'Schema.optional($A)'],
  ['z.nullable($A)', 'Schema.NullOr($A)'],
  ['z.default($A, $B)', 'Schema.withDecodingDefault($A, () => $B)'],
  ['z.describe($A, $B)', 'Schema.annotate({ description: $B })($A)'],
  ['$A.optional()', 'Schema.optional($A)'],
  ['$A.nullable()', 'Schema.NullOr($A)'],
  ['$A.default($B)', 'Schema.withDecodingDefault($A, () => $B)'],
  ['$A.describe($B)', 'Schema.annotate({ description: $B })($A)'],
]
const residualPatterns = [
  ['.refine', '$A.refine($B)', /\.refine\s*\(/],
  ['.superRefine', '$A.superRefine($B)', /\.superRefine\s*\(/],
  ['.transform', '$A.transform($B)', /\.transform\s*\(/],
  ['.preprocess', 'z.preprocess($A, $B)', /\bz\s*\.\s*preprocess\s*\(/],
  ['z.custom', 'z.custom($A)', /\bz\s*\.\s*custom\s*\(/],
  ['.passthrough', '$A.passthrough()', /\.passthrough\s*\(/],
]

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
  let output = source
  let rewriteCount = 0
  for (const [pattern, fix] of replacements) {
    await writeFile(tempPath, output)
    while (true) {
      await writeFile(tempPath, output)
      const matches = astGrepMatches(tempPath, pattern, fix).filter(match => match.text.includes('z.') || match.text.includes('Schema.'))
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
  if (rewriteCount && /from\s+['"]zod['"]/.test(output) && !/from\s+['"]effect\/Schema['"]/.test(output)) {
    const firstImport = output.match(/^import .*?;?\r?\n/m)?.[0]
    if (firstImport) output = output.replace(firstImport, `${firstImport}import * as Schema from 'effect/Schema'\n`)
  }
  return { output, rewriteCount }
}

const countResiduals = (source, file) => {
  const results = []
  for (const [name, pattern, fastPattern] of residualPatterns) {
    if (!fastPattern.test(source)) continue
    for (const match of astGrepMatches(file, pattern)) {
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
    const { output, rewriteCount } = await rewriteSource(source, file, temporary)
    await writeFile(resolve(temporary, basename(file)), output)
    const residuals = countResiduals(output, resolve(temporary, basename(file)))
    reports.push({ file: relative(root, file), rewrites: rewriteCount, pending: output !== source, residuals })
    if (mode === 'write' && output !== source) await writeFile(file, output)
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
