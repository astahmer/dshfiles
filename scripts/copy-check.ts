// Copy check: banned glossary terms in user-facing plugin labels, as a ratchet.
//
// The ADE plan glossary (docs/ade-ux/README.md §3) names one word per concept: thread (not session, chat or
// conversation), land (not integrate), done (not settle), and labels never carry a plugin name. This script scans
// client copy — string literals and JSX text in plugin `.tsx` files, locale tables, and the UI labels quoted in
// `dshx.features.json` `reach` steps — and counts findings per term and plugin. It fails only when one `term/plugin`
// count rises above `scripts/copy-check.baseline.json`, so a fix in one plugin cannot hide a regression in another.
//
//   node --run check:copy             # compare with the baseline; fail on an increase
//   node --run check:copy -- --report # list every finding
//   node --run check:copy -- --update # write the current counts (ratchet down after a copy fix)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'
import { ScriptJson } from './json.ts'

export interface CopyTerm {
  readonly id: string
  readonly pattern: RegExp
  readonly use: string
}

/** Glossary terms banned in UI copy, with the word to use instead. Session stays legal in API/tool names and docs. */
export const copyTerms: readonly CopyTerm[] = [
  { id: 'session', pattern: /\bsessions?\b/i, use: 'thread' },
  { id: 'conversation', pattern: /\bconversations?\b/i, use: 'thread' },
  { id: 'new-chat', pattern: /\bnew chat\b/i, use: 'New thread' },
  { id: 'integrate', pattern: /\bintegrat(?:e|es|ed|ing)\b/i, use: 'land' },
  { id: 'settle', pattern: /\bsettl(?:e|es|ed|ing)\b/i, use: 'done' },
]

/** `Plugin Name: View` prefixes, derived from each plugin directory (`jj-integration` → `JJ Integration:`). */
const pluginPrefixPattern = (pluginNames: readonly string[]): RegExp => {
  const alternatives = pluginNames
    .filter(name => name.length > 0)
    .map(name =>
      name
        .split('-')
        .map(part => part.replace(/[a-z]/gi, letter => `[${letter.toLowerCase()}${letter.toUpperCase()}]`).replace(/[.*+?^${}()|\\]/g, '\\$&'))
        .join('[ .-]'),
    )
  const names = `(?:${alternatives.join('|')})`
  // A capital after the colon: `pulls.review: Reviews` is a label, `pulls.review: marks stay unsaved` a log line. A
  // template hole (`${}` in a string's raw form) after a title-form name counts too: `AI Accounts: ${translate(…)}`
  // is a label, `main-tabs: ${commandId} shortcut` a registration's debug name.
  return new RegExp(`^\\s*(?:${names}\\s*:\\s+[A-Z\\u3000-\\u9fff]|(?=[^:]*[A-Z])${names}\\s*:\\s+\\$\\{)`)
}

export interface CopyString {
  readonly text: string
  readonly line: number
  /** The text with each template hole kept as `${}`; absent when it equals `text`. */
  readonly raw?: string
  /** The property key (`label`) or method call (`description()`) the literal is the value or first argument of. */
  readonly key?: string
}

/** What a literal belongs to, read from the code before it: `label: '…'` → `label`, `.description('…')` → `description()`. */
const keyBefore = (code: string): string | undefined => {
  const tail = code.slice(-160)
  const call = /\.(\w+)\(\s*$/.exec(tail)
  if (call !== null) return `${call[1] ?? ''}()`
  return /(?:^|[{,\n])\s*(\w+)\??\s*:\s*$/.exec(tail)?.[1]
}

/** Line numbers by offset, from the line starts indexed once per file (a linear count per string is quadratic). */
const lineIndex = (source: string): ((index: number) => number) => {
  const starts = [0]
  for (let position = 0; position < source.length; position += 1) if (source.charCodeAt(position) === 10) starts.push(position + 1)
  return index => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((starts[middle] ?? 0) <= index) low = middle
      else high = middle - 1
    }
    return low + 1
  }
}

/** Locale codes other than English, as a table name (`const fr = {`, `zhCN`) or key (`'pt-BR': {`). */
const NON_ENGLISH_LOCALE = String.raw`(?:zh|ja|es|fr|de|ru|pt|ko|it|nl|pl|tr|uk|ar|hi|vi|th|sv|cs)(?:[-_]?[A-Z][A-Za-z]*)?`

/**
 * Source ranges holding a non-English locale table: a `const fr = {` declaration or an `fr: {` / `'zh-CN': {` key,
 * up to the closing brace at the same indentation. The glossary is English; `conversation` is also French.
 */
const nonEnglishRanges = (source: string): readonly (readonly [number, number])[] => {
  const ranges: (readonly [number, number])[] = []
  const opener = new RegExp(
    String.raw`^([ \t]*)(?:(?:export\s+)?(?:const|let)\s+${NON_ENGLISH_LOCALE}\b[^=\n]*=|['"]?${NON_ENGLISH_LOCALE}['"]?\s*:)\s*\{`,
    'gm',
  )
  for (const match of source.matchAll(opener)) {
    const indent = match[1] ?? ''
    const opened = match.index + match[0].length
    const newline = source.indexOf('\n', opened)
    const lineEnd = newline === -1 ? source.length : newline
    // `es: { a: '…' },` on one line ends with its line.
    if (source.slice(opened, lineEnd).trim().length > 0) {
      ranges.push([match.index, lineEnd])
      continue
    }
    const closer = new RegExp(String.raw`^${indent}\}`, 'gm')
    closer.lastIndex = opened
    const end = closer.exec(source)
    ranges.push([match.index, end === null ? source.length : end.index])
  }
  return ranges
}

/**
 * String literals, template literals (without their `${…}` holes) and JSX text of one source file. A small lexer
 * rather than a parser: it skips comments, regex-free code and nested template holes well enough for a ratchet.
 */
const extractStrings = (source: string): readonly CopyString[] => {
  const strings: CopyString[] = []
  const lineAt = lineIndex(source)
  const foreign = nonEnglishRanges(source)
  let code = ''
  let index = 0
  const push = (text: string, start: number, raw: string = text): void => {
    // Developer diagnostics, not copy.
    if (/console\.\w+\([^;\n)]*$/.test(code.slice(-400))) return
    if (foreign.some(([from, to]) => start >= from && start < to)) return
    const key = keyBefore(code)
    strings.push({ text, line: lineAt(start), ...(raw === text ? {} : { raw }), ...(key === undefined ? {} : { key }) })
  }
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      code += ' '
      continue
    }
    if (char === "'" || char === '"') {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `index` advances past the literal.
      const start = index
      let text = ''
      index += 1
      while (index < source.length && source[index] !== char && source[index] !== '\n') {
        if (source[index] === '\\') {
          text += source[index + 1] ?? ''
          index += 2
          continue
        }
        text += source[index]
        index += 1
      }
      index += 1
      push(text, start)
      code += '""'
      continue
    }
    if (char === '`') {
      // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `index` advances past the literal.
      const start = index
      let text = ''
      let raw = ''
      index += 1
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\') {
          text += source[index + 1] ?? ''
          raw += source[index + 1] ?? ''
          index += 2
          continue
        }
        if (source[index] === '$' && source[index + 1] === '{') {
          let depth = 1
          index += 2
          while (index < source.length && depth > 0) {
            if (source[index] === '{') depth += 1
            else if (source[index] === '}') depth -= 1
            index += 1
          }
          text += ' '
          raw += '${}'
          continue
        }
        text += source[index]
        raw += source[index]
        index += 1
      }
      index += 1
      push(text, start, raw)
      code += '""'
      continue
    }
    code += char
    index += 1
  }
  // JSX text: prose between a closing `>` and the next `<` of the comment- and string-free code. Locale tables hold no
  // JSX, so the foreign ranges do not apply here.
  for (const match of code.matchAll(/>([^<>{}]*)</g)) {
    const text = match[1] ?? ''
    if (!/[A-Za-z]{2}/.test(text) || /&&|\|\||=|;|\(|\)/.test(text)) continue
    // Type arguments (`Snapshot<X> readonly ids: Y<`) look like JSX text to a lexer.
    if (/\b(?:readonly|interface|export|const|let|return|extends|keyof|typeof|function|import)\b/.test(text)) continue
    if (/\b[a-z]\w*\??:\s*(?:boolean|string|number|unknown|void|null|undefined|[A-Z]\w*(?:<|\[|\s*$))/.test(text)) continue
    // Offsets in `code` drift from `source` where literals were collapsed, so find the text in the source.
    const at = source.indexOf(text.trim())
    strings.push({ text: text.trim(), line: at === -1 ? 0 : lineAt(at) })
  }
  return strings
}

/** Copy, not code: has a space between words and no Tailwind, path, selector or identifier shape. */
const isProse = (text: string): boolean => {
  const trimmed = text.trim()
  if (!/[A-Za-z]{2,}\s+[A-Za-z]/.test(trimmed)) return false
  if (/dshx:|^[@./#]|^https?:|^[a-z]+(?:[.-][a-z0-9]+)+$|=>|\bimport\b/.test(trimmed)) return false
  return true
}

export interface CopyComparison {
  readonly increased: readonly string[]
  readonly decreased: readonly string[]
}

export interface CopyFinding {
  readonly term: string
  readonly plugin: string
  readonly file: string
  readonly line: number
  readonly text: string
}

/** The plugin directory a repository path belongs to (`plugins/@dshfiles/<plugin>/…`). */
const pluginOf = (file: string): string => /^plugins\/@dshfiles\/([^/]+)\//.exec(file)?.[1] ?? 'other'

const findingsInStrings = (input: { readonly file: string; readonly strings: readonly CopyString[]; readonly prefix: RegExp }): readonly CopyFinding[] => {
  const findings: CopyFinding[] = []
  const plugin = pluginOf(input.file)
  for (const string of input.strings) {
    const prefixed = input.prefix.test(string.raw ?? string.text)
    if (!isProse(string.text) && !prefixed) continue
    const at = { plugin, file: input.file, line: string.line, text: (string.raw ?? string.text).trim().slice(0, 120) }
    if (prefixed) findings.push({ term: 'plugin-prefix', ...at })
    for (const term of copyTerms) if (term.pattern.test(string.text)) findings.push({ term: term.id, ...at })
  }
  return findings
}

const isLocaleFile = (path: string): boolean => /(?:^|\/)(?:locales?|i18n)(?:\/[^/]+)?\.ts$|-locales?\.ts$/.test(path)

/**
 * The copy in a plain `.ts` file (not a component, not a locale table): the `.description(…)` text of a settings
 * schema, which Settings shows under each field.
 */
const holdsPlainTsCopy = (source: string): boolean => source.includes('defineSettings')

const copyInPlainTs = (source: string, strings: readonly CopyString[]): readonly CopyString[] =>
  holdsPlainTsCopy(source) ? strings.filter(string => string.key === 'description()') : []

const walk = (directory: string, files: string[]): void => {
  for (const entry of readdirSync(directory)) {
    // Vendored native forks (`src/native/`) are read too: their labels reach the same screens as owned copy.
    if (entry === 'node_modules' || entry === 'dist' || entry === '__snapshots__') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else files.push(path)
  }
}

const catalogSchema = Schema.Struct({
  features: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        summary: Schema.optional(Schema.String),
        reach: Schema.optional(Schema.Array(Schema.String)),
        onboarding: Schema.optional(Schema.Struct({ firstAction: Schema.optional(Schema.String), doneWhen: Schema.optional(Schema.String) })),
      }),
    ),
  ),
})

type Catalog = typeof catalogSchema.Type

/** The catalog text users read: Getting started and the plugin guide show each feature's title and summary, and onboarding its first action and done-when sentence. */
const catalogCopy = (catalog: Catalog): readonly CopyString[] =>
  (catalog.features ?? []).flatMap(feature =>
    [feature.title, feature.summary, feature.onboarding?.firstAction, feature.onboarding?.doneWhen]
      .filter((text): text is string => text !== undefined)
      .map(text => ({ text, line: 0 })),
  )

/** Every finding in the repository's owned plugins, sorted for stable output. */
const scanRepository = (root: string): readonly CopyFinding[] => {
  const pluginsRoot = join(root, 'plugins/@dshfiles')
  const plugins = readdirSync(pluginsRoot).filter(name => statSync(join(pluginsRoot, name)).isDirectory())
  const prefix = pluginPrefixPattern(plugins)
  const findings: CopyFinding[] = []
  for (const plugin of plugins) {
    const sourceRoot = join(pluginsRoot, plugin, 'src')
    const files: string[] = []
    try {
      walk(sourceRoot, files)
    } catch {
      // A package without src (styles-only) has no copy.
    }
    for (const file of files) {
      const rel = relative(root, file)
      if (/\.(?:test|spec|characterization\.test)\.tsx?$/.test(rel) || !/\.tsx?$/.test(rel) || rel.endsWith('.d.ts')) continue
      const source = readFileSync(file, 'utf8')
      const whole = rel.endsWith('.tsx') || isLocaleFile(rel)
      // Lexing every Host file costs seconds; a plain .ts file is read only when it can hold copy.
      if (!whole && !holdsPlainTsCopy(source)) continue
      const strings = extractStrings(source)
      const copy = whole ? strings : copyInPlainTs(source, strings)
      findings.push(...findingsInStrings({ file: rel, strings: copy, prefix }))
    }
    const catalog = join(pluginsRoot, plugin, 'dshx.features.json')
    let text: string
    try {
      text = readFileSync(catalog, 'utf8')
    } catch {
      continue
    }
    const decoded = ScriptJson.decodeJsonSafe(catalogSchema, text)
    if (!decoded.success) continue
    const rel = relative(root, catalog)
    findings.push(...findingsInStrings({ file: rel, strings: catalogCopy(decoded.data), prefix }))
    const labels = new Set<string>()
    for (const feature of decoded.data.features ?? [])
      for (const step of feature.reach ?? []) for (const quoted of step.matchAll(/"([^"]+)"/g)) labels.add(quoted[1] ?? '')
    // Reach labels are UI names even when they are one word, so only the prefix and glossary terms apply.
    for (const label of labels) {
      if (prefix.test(label)) findings.push({ term: 'plugin-prefix', plugin, file: rel, line: 0, text: label })
      for (const term of copyTerms) if (term.pattern.test(label)) findings.push({ term: term.id, plugin, file: rel, line: 0, text: label })
    }
  }
  return findings.toSorted((left, right) => left.term.localeCompare(right.term) || left.file.localeCompare(right.file) || left.line - right.line)
}

const termIds = (): readonly string[] => ['plugin-prefix', ...copyTerms.map(entry => entry.id)]

/** Counts keyed `term/plugin`, so a fix in one plugin cannot hide a regression in another. */
const countByTermAndPlugin = (findings: readonly CopyFinding[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const finding of findings) {
    const key = `${finding.term}/${finding.plugin}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)))
}

const totalsByTerm = (findings: readonly CopyFinding[]): Readonly<Record<string, number>> =>
  Object.fromEntries(termIds().map(term => [term, findings.filter(finding => finding.term === term).length]))

const baselineSchema = Schema.Struct({ totals: Schema.Record(Schema.String, Schema.Number), counts: Schema.Record(Schema.String, Schema.Number) })

const compare = (input: { readonly baseline: Readonly<Record<string, number>>; readonly current: Readonly<Record<string, number>> }): CopyComparison => {
  const increased: string[] = []
  const decreased: string[] = []
  for (const key of new Set([...Object.keys(input.baseline), ...Object.keys(input.current)])) {
    const count = input.current[key] ?? 0
    const cap = input.baseline[key] ?? 0
    if (count > cap) increased.push(`${key}: ${count} > baseline ${cap}`)
    else if (count < cap) decreased.push(`${key}: ${count} < baseline ${cap}`)
  }
  return { increased: increased.toSorted(), decreased: decreased.toSorted() }
}

/** The copy check's pure parts, exported for its tests. */
export class CopyCheck {
  static readonly terms = copyTerms
  static readonly pluginPrefixPattern = pluginPrefixPattern
  static readonly extractStrings = extractStrings
  static readonly isProse = isProse
  static readonly copyInPlainTs = copyInPlainTs
  static readonly catalogCopy = catalogCopy
  static readonly findingsInStrings = findingsInStrings
  static readonly scanRepository = scanRepository
  static readonly pluginOf = pluginOf
  static readonly countByTermAndPlugin = countByTermAndPlugin
  static readonly totalsByTerm = totalsByTerm
  static readonly compare = compare
}

const main = (): void => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const baselineUrl = new URL('./copy-check.baseline.json', import.meta.url)
  const findings = scanRepository(root)
  const current = countByTermAndPlugin(findings)
  const args = new Set(process.argv.slice(2))
  if (args.has('--report')) for (const finding of findings) console.log(`${finding.term}\t${finding.file}:${finding.line}\t${finding.text}`)
  if (args.has('--update')) {
    writeFileSync(baselineUrl, `${JSON.stringify({ totals: totalsByTerm(findings), counts: current }, null, 2)}\n`)
    console.log(`copy-check: baseline written (${findings.length} findings).`)
    return
  }
  const baseline = ScriptJson.decodeJson(baselineSchema, readFileSync(baselineUrl, 'utf8')).counts
  const { increased, decreased } = compare({ baseline, current })
  const use = new Map(copyTerms.map(term => [term.id, term.use]))
  use.set('plugin-prefix', 'the view name alone')
  if (increased.length > 0) {
    console.error('copy-check: banned glossary terms increased in UI copy (docs/ade-ux/README.md §3 Glossary):')
    for (const line of increased) console.error(`  ${line} — use "${use.get(line.split('/')[0] ?? '') ?? ''}"`)
    console.error('Run `node --run check:copy -- --report` to list findings and fix the new copy.')
    process.exitCode = 1
    return
  }
  const totals = Object.entries(totalsByTerm(findings)).filter(([, count]) => count > 0)
  console.log(`copy-check: ${findings.length} findings (${totals.map(([term, count]) => `${term} ${count}`).join(', ')}), none above the baseline.`)
  if (decreased.length > 0) {
    console.log('Fewer findings than the baseline; ratchet it down with `node --run check:copy -- --update`:')
    for (const line of decreased) console.log(`  ${line}`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
