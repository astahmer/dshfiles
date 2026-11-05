import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { hostFiles, runtimeImportTargets } from '../tooling/antislop/effect/host-files.mjs'

const optionValue = name => process.argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3)
const repositoryRoot = resolve(optionValue('root') ?? fileURLToPath(new URL('..', import.meta.url)))
const baselinePath = resolve(optionValue('baseline') ?? join(repositoryRoot, 'scripts/effect-native-audit.baseline.json'))
const pluginsDirectory = join(repositoryRoot, 'plugins/@dshfiles')
const json = process.argv.includes('--json')
const update = process.argv.includes('--update')

const debtMetrics = [
  { key: 'layerEmpty', label: 'Layer.empty' },
  { key: 'promiseAdapters', label: 'Promise→Effect' },
  { key: 'moduleState', label: 'module let/WeakMap' },
  { key: 'timers', label: 'timers' },
  { key: 'childProcess', label: 'child_process' },
  { key: 'nodeFs', label: 'node:fs' },
  { key: 'globalFetch', label: 'fetch' },
  { key: 'testMocks', label: 'Host test mocks' },
  { key: 'runOutsideEdges', label: 'run*' },
  { key: 'syncDecodeInEffect', label: 'decodeUnknownSync in Effect' },
]
const infoMetrics = [
  { key: 'taggedErrors', label: 'TaggedError' },
  { key: 'causelessErrors', label: 'TaggedError w/o cause' },
  { key: 'effectVitestFiles', label: '@effect/vitest tests' },
  { key: 'services', label: 'Context.Service' },
]

const skippedDirectories = new Set(['node_modules', 'dist', '.turbo', 'coverage'])
const testFilePattern = /\.(?:test|spec)\.[cm]?tsx?$/u
const clientTestPattern = /\.tsx$|\.client\.(?:test|spec)\./u
const globalCallees = new Set(['fetch', 'Promise', 'import', 'setTimeout', 'setInterval', 'queueMicrotask', 'structuredClone'])
const nonCalleeWords = new Set(['async', 'await', 'function', 'new', 'return', 'void', 'typeof'])

const listFiles = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return skippedDirectories.has(entry.name) || path.endsWith('/src/native') ? [] : listFiles(path)
    return [path]
  })

const stripComments = source => {
  let output = ''
  let quote
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote !== undefined) {
      output += character
      if (character === '\\') {
        output += source[index + 1] ?? ''
        index += 1
      } else if (character === quote) quote = undefined
      continue
    }
    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      output += '\n'
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 1
      continue
    }
    if (character === "'" || character === '"' || character === '`') quote = character
    output += character
  }
  return output
}

const count = (source, pattern) => [...source.matchAll(pattern)].length

/** The source with string and template literal contents blanked, so code embedded as text (a browser script) is not counted. */
const withoutLiterals = source => {
  let output = ''
  let quote
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote === undefined) {
      if (character === "'" || character === '"' || character === '`') quote = character
      output += character
      continue
    }
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === quote) {
      quote = undefined
      output += character
    }
  }
  return output
}

const runtimeImports = source => {
  const imports = new Map()
  for (const match of source.matchAll(/\bimport\s+(type\s+)?([^'";]*?)\s+from\s*['"]([^'"]+)['"]/gsu)) {
    if (match[1] !== undefined) continue
    for (const name of match[2].replace(/[{}]/gu, ',').split(',')) {
      const local = name
        .trim()
        .replace(/^type\s+/u, '')
        .split(/\s+as\s+|\s*\*\s*as\s+/u)
        .pop()
        ?.trim()
      if (local) imports.set(local, match[3])
    }
  }
  return imports
}

const importsModule = (source, modules) => {
  let found = 0
  for (const match of source.matchAll(/\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/gsu)) {
    if (match[1] === undefined && modules.has(match[2])) found += 1
  }
  return found
}

const wrappedRoot = snippet => {
  const tryValue = snippet.match(/^\s*\{[\s\S]*?\btry\s*:\s*([\s\S]*)$/u)?.[1] ?? snippet
  const bareReference = tryValue.match(/^\s*([A-Za-z_$][\w$]*)\s*[,}\n]/u)
  if (bareReference !== null) return bareReference[1]
  for (const match of tryValue.matchAll(/([A-Za-z_$][\w$]*)(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*\s*\(/gu)) {
    if (!nonCalleeWords.has(match[1])) return match[1]
  }
  return undefined
}

/** A class or object method named `fetch` (for example a native Promise provider's entry point), not a call. */
const fetchMethodPattern = /^[ \t]*(?:(?:public|private|protected|static|async|override)\s+)*fetch\s*\([^)]*\)\s*(?::[^{;\n]*)?\{/gmu

/** Calls to a bare `fetch(`; text inside string literals and methods that are merely named `fetch` do not count. */
const globalFetchCalls = source => {
  const code = withoutLiterals(source)
  return count(code, /(?<![\w$.])fetch\s*\(/gu) - count(code, fetchMethodPattern)
}

const isOwnSpecifier = specifier => specifier.startsWith('.') || specifier.startsWith('@dshfiles/')

const promiseAdapters = source => {
  const imports = runtimeImports(source)
  let adapters = count(source, /\b(?:effectify|effectHandler|liftHandler)\s*\(/gu)
  for (const match of source.matchAll(/\bEffect\.(?:tryPromise|promise)\s*\(/gu)) {
    const root = wrappedRoot(source.slice(match.index + match[0].length, match.index + match[0].length + 400))
    if (root === undefined || globalCallees.has(root)) continue
    const specifier = imports.get(root)
    if (specifier === undefined || isOwnSpecifier(specifier)) adapters += 1
  }
  return adapters
}

const balancedCall = (source, openIndex) => {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') depth -= 1
    if (depth === 0) return source.slice(openIndex, index + 1)
  }
  return source.slice(openIndex)
}

const taggedErrorFields = source =>
  [...source.matchAll(/\bSchema\.TaggedError\b(?:<[^>]*>)?\s*\(\s*\)\s*\(/gu)].map(match => balancedCall(source, match.index + match[0].length - 1))

const promiseEdgePattern = /-promise\.ts$/u

const hostMetrics = (source, file) => {
  const errors = taggedErrorFields(source)
  const promiseEdge = promiseEdgePattern.test(file)
  return {
    layerEmpty: count(source, /\bLayer\.empty\b/gu),
    promiseAdapters: promiseEdge ? 0 : promiseAdapters(source),
    moduleState: count(source, /^(?:export\s+)?(?:let|var)\s/gmu) + count(source, /\bnew\s+WeakMap\s*<\s*(?:[\w$]+\.)?Context\b/gu),
    timers: count(withoutLiterals(source), /(?<![\w$.])(?:globalThis\.)?(?:setTimeout|setInterval)\s*\(/gu),
    childProcess: importsModule(source, new Set(['node:child_process', 'child_process'])),
    nodeFs: importsModule(source, new Set(['node:fs', 'node:fs/promises', 'fs', 'fs/promises'])),
    globalFetch: globalFetchCalls(source),
    causelessErrors: errors.filter(fields => !/\bDefect\b/u.test(fields)).length,
    runOutsideEdges: promiseEdge ? 0 : count(source, /\.run(?:Promise|Fork|Sync|Callback)(?:Exit)?\s*\(/gu),
    syncDecodeInEffect: /\bEffect\.(?:gen|fn)\b/u.test(source) ? count(source, /\bdecodeUnknownSync\b/gu) : 0,
    taggedErrors: errors.length,
    services: count(source, /\bContext\.Service\b/gu),
  }
}

const testMetrics = source => ({
  testMocks: count(source, /\bvi\.(?:mock|doMock|fn|useFakeTimers)\s*\(/gu),
  effectVitestFiles: /from\s*['"]@effect\/vitest['"]/u.test(source) ? 1 : 0,
})

const emptyMetrics = () => Object.fromEntries([...debtMetrics, ...infoMetrics].map(metric => [metric.key, 0]))

const addInto = (target, values) => {
  for (const [key, value] of Object.entries(values)) target[key] += value
}

const auditPlugin = (pluginDirectory, hosts) => {
  const metrics = emptyMetrics()
  let hostFileCount = 0
  for (const file of listFiles(pluginDirectory)) {
    if (testFilePattern.test(file)) {
      if (clientTestPattern.test(file)) continue
      const testsHost = runtimeImportTargets({ repositoryRoot, file }).some(target => hosts.has(target))
      if (testsHost) addInto(metrics, testMetrics(stripComments(readFileSync(file, 'utf8'))))
      continue
    }
    if (!hosts.has(file) || file.includes('/src/native/')) continue
    hostFileCount += 1
    addInto(metrics, hostMetrics(stripComments(readFileSync(file, 'utf8')), file))
  }
  return { hostFileCount, metrics }
}

const debtScore = metrics => debtMetrics.reduce((sum, metric) => sum + metrics[metric.key], 0)

const audit = () => {
  const hosts = hostFiles(repositoryRoot)
  return readdirSync(pluginsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ plugin: `@dshfiles/${entry.name}`, ...auditPlugin(join(pluginsDirectory, entry.name), hosts) }))
    .filter(row => row.hostFileCount > 0 || debtScore(row.metrics) > 0)
    .map(row => ({ ...row, score: debtScore(row.metrics) }))
    .sort((left, right) => right.score - left.score || left.plugin.localeCompare(right.plugin))
}

const baselineOf = rows =>
  Object.fromEntries(
    rows
      .map(row => [row.plugin, Object.fromEntries(debtMetrics.map(metric => [metric.key, row.metrics[metric.key]]))])
      .sort(([left], [right]) => left.localeCompare(right)),
  )

const regressionsAgainst = (rows, baseline) =>
  rows.flatMap(row =>
    debtMetrics
      .filter(metric => row.metrics[metric.key] > (baseline[row.plugin]?.[metric.key] ?? 0))
      .map(metric => ({ plugin: row.plugin, metric: metric.key, current: row.metrics[metric.key], baseline: baseline[row.plugin]?.[metric.key] ?? 0 })),
  )

const printTable = rows => {
  const columns = [{ key: 'plugin', label: 'plugin' }, { key: 'score', label: 'debt' }, ...debtMetrics, ...infoMetrics]
  const cells = rows.map(row =>
    columns.map(column => String(column.key === 'plugin' ? row.plugin : column.key === 'score' ? row.score : row.metrics[column.key])),
  )
  const totals = emptyMetrics()
  for (const row of rows) addInto(totals, row.metrics)
  cells.push(columns.map(column => (column.key === 'plugin' ? 'TOTAL' : String(column.key === 'score' ? debtScore(totals) : totals[column.key]))))
  const widths = columns.map((column, index) => Math.max(column.label.length, ...cells.map(row => row[index].length)))
  const line = values => `| ${values.map((value, index) => (index === 0 ? value.padEnd(widths[index]) : value.padStart(widths[index]))).join(' | ')} |`
  console.log(line(columns.map(column => column.label)))
  console.log(`|${widths.map((width, index) => (index === 0 ? '-'.repeat(width + 2) : `${'-'.repeat(width + 1)}:`)).join('|')}|`)
  for (const row of cells) console.log(line(row))
}

const rows = audit()

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify(baselineOf(rows), null, 2)}\n`)
  console.log(`Updated ${relative(process.cwd(), baselinePath)} for ${rows.length} plugins.`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error(`Missing ${relative(process.cwd(), baselinePath)}; run node scripts/effect-native-audit.mjs --update to record one.`)
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const regressions = regressionsAgainst(rows, baseline)

if (json) console.log(JSON.stringify({ plugins: rows, regressions }, null, 2))
if (!json) printTable(rows)

if (regressions.length > 0) {
  console.error(`\nEffect-native debt grew against ${relative(process.cwd(), baselinePath)}:`)
  for (const regression of regressions) console.error(`  ${regression.plugin} ${regression.metric}: ${regression.current} (baseline ${regression.baseline})`)
  console.error('Fix the new debt; the baseline may only go down (node scripts/effect-native-audit.mjs --update after an improvement).')
  process.exit(1)
}

const improved = rows.some(row => debtMetrics.some(metric => row.metrics[metric.key] < (baseline[row.plugin]?.[metric.key] ?? 0)))
if (improved && !json) console.log('\nSome metrics improved; run node scripts/effect-native-audit.mjs --update to lower the baseline.')
