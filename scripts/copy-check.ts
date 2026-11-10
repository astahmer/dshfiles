// Copy check: banned glossary terms in user-facing plugin labels, as a ratchet.
//
// The ADE plan glossary (docs/ade-ux/README.md §3) names one word per concept: thread (not session, chat or
// conversation), land (not integrate), done (not settle), and labels never carry a plugin name. This script scans
// client copy — string literals and JSX text in plugin `.tsx` files, locale tables, and the UI labels quoted in
// `dshx.features.json` `reach` steps — and counts findings per term. It fails only when a term's count rises above
// `scripts/copy-check.baseline.json`, so it can land while the copy pass is still under way.
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
  // A capital after the colon: `pulls.review: Reviews` is a label, `pulls.review: marks stay unsaved` a log line.
  return new RegExp(`^\\s*(?:${alternatives.join('|')})\\s*:\\s+[A-Z\\u3000-\\u9fff]`)
}

export interface CopyString {
  readonly text: string
  readonly line: number
}

const lineAt = (source: string, index: number): number => {
  let line = 1
  for (let position = 0; position < index; position += 1) if (source.charCodeAt(position) === 10) line += 1
  return line
}

/**
 * String literals, template literals (without their `${…}` holes) and JSX text of one source file. A small lexer
 * rather than a parser: it skips comments, regex-free code and nested template holes well enough for a ratchet.
 */
const extractStrings = (source: string): readonly CopyString[] => {
  const strings: CopyString[] = []
  let code = ''
  let index = 0
  const push = (text: string, start: number): void => {
    // Developer diagnostics, not copy.
    if (/console\.\w+\([^;\n)]*$/.test(code.slice(-400))) return
    strings.push({ text, line: lineAt(source, start) })
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
      index += 1
      while (index < source.length && source[index] !== '`') {
        if (source[index] === '\\') {
          text += source[index + 1] ?? ''
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
    code += char
    index += 1
  }
  // JSX text: prose between a closing `>` and the next `<` of the comment- and string-free code.
  for (const match of code.matchAll(/>([^<>{}]*)</g)) {
    const text = match[1] ?? ''
    if (!/[A-Za-z]{2}/.test(text) || /&&|\|\||=|;|\(|\)/.test(text)) continue
    // Type arguments (`Snapshot<X> readonly ids: Y<`) look like JSX text to a lexer.
    if (/\b(?:readonly|interface|export|const|let|return|extends|keyof|typeof|function|import)\b/.test(text)) continue
    if (/\b[a-z]\w*\??:\s*(?:boolean|string|number|unknown|void|null|undefined|[A-Z]\w*(?:<|\[|\s*$))/.test(text)) continue
    // Offsets in `code` drift from `source` where literals were collapsed, so find the text in the source.
    const at = source.indexOf(text.trim())
    strings.push({ text: text.trim(), line: at === -1 ? 0 : lineAt(source, at) })
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
  readonly file: string
  readonly line: number
  readonly text: string
}

const findingsInStrings = (input: { readonly file: string; readonly strings: readonly CopyString[]; readonly prefix: RegExp }): readonly CopyFinding[] => {
  const findings: CopyFinding[] = []
  for (const string of input.strings) {
    if (!isProse(string.text) && !input.prefix.test(string.text)) continue
    const excerpt = string.text.trim().slice(0, 120)
    if (input.prefix.test(string.text)) findings.push({ term: 'plugin-prefix', file: input.file, line: string.line, text: excerpt })
    for (const term of copyTerms) if (term.pattern.test(string.text)) findings.push({ term: term.id, file: input.file, line: string.line, text: excerpt })
  }
  return findings
}

const isLocaleFile = (path: string): boolean => /(?:^|\/)(?:locales?|i18n)(?:\/[^/]+)?\.ts$|-locales?\.ts$/.test(path)

const walk = (directory: string, files: string[]): void => {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'native' || entry === '__snapshots__') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else files.push(path)
  }
}

const reachSchema = Schema.Struct({
  features: Schema.optional(Schema.Array(Schema.Struct({ reach: Schema.optional(Schema.Array(Schema.String)) }))),
})

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
      if (/\.(?:test|spec|characterization\.test)\.tsx?$/.test(rel)) continue
      if (!rel.endsWith('.tsx') && !isLocaleFile(rel)) continue
      findings.push(...findingsInStrings({ file: rel, strings: extractStrings(readFileSync(file, 'utf8')), prefix }))
    }
    const catalog = join(pluginsRoot, plugin, 'dshx.features.json')
    let text: string
    try {
      text = readFileSync(catalog, 'utf8')
    } catch {
      continue
    }
    const decoded = ScriptJson.decodeJsonSafe(reachSchema, text)
    if (!decoded.success) continue
    const labels = new Set<string>()
    for (const feature of decoded.data.features ?? [])
      for (const step of feature.reach ?? []) for (const quoted of step.matchAll(/"([^"]+)"/g)) labels.add(quoted[1] ?? '')
    // Reach labels are UI names even when they are one word, so only the prefix and glossary terms apply.
    const rel = relative(root, catalog)
    for (const label of labels) {
      if (prefix.test(label)) findings.push({ term: 'plugin-prefix', file: rel, line: 0, text: label })
      for (const term of copyTerms) if (term.pattern.test(label)) findings.push({ term: term.id, file: rel, line: 0, text: label })
    }
  }
  return findings.toSorted((left, right) => left.term.localeCompare(right.term) || left.file.localeCompare(right.file) || left.line - right.line)
}

const countByTerm = (findings: readonly CopyFinding[]) =>
  Object.fromEntries(['plugin-prefix', ...copyTerms.map(entry => entry.id)].map(term => [term, findings.filter(finding => finding.term === term).length]))

const baselineSchema = Schema.Struct({ counts: Schema.Record(Schema.String, Schema.Number) })

const compare = (input: { readonly baseline: Readonly<Record<string, number>>; readonly current: Readonly<Record<string, number>> }): CopyComparison => {
  const increased: string[] = []
  const decreased: string[] = []
  for (const [term, count] of Object.entries(input.current)) {
    const cap = input.baseline[term] ?? 0
    if (count > cap) increased.push(`${term}: ${count} > baseline ${cap}`)
    else if (count < cap) decreased.push(`${term}: ${count} < baseline ${cap}`)
  }
  return { increased, decreased }
}

/** The copy check's pure parts, exported for its tests. */
export class CopyCheck {
  static readonly terms = copyTerms
  static readonly pluginPrefixPattern = pluginPrefixPattern
  static readonly extractStrings = extractStrings
  static readonly isProse = isProse
  static readonly findingsInStrings = findingsInStrings
  static readonly scanRepository = scanRepository
  static readonly countByTerm = countByTerm
  static readonly compare = compare
}

const main = (): void => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const baselineUrl = new URL('./copy-check.baseline.json', import.meta.url)
  const findings = scanRepository(root)
  const current = countByTerm(findings)
  const args = new Set(process.argv.slice(2))
  if (args.has('--report')) for (const finding of findings) console.log(`${finding.term}\t${finding.file}:${finding.line}\t${finding.text}`)
  if (args.has('--update')) {
    writeFileSync(baselineUrl, `${JSON.stringify({ counts: current }, null, 2)}\n`)
    console.log(`copy-check: baseline written (${findings.length} findings).`)
    return
  }
  const baseline = ScriptJson.decodeJson(baselineSchema, readFileSync(baselineUrl, 'utf8')).counts
  const { increased, decreased } = compare({ baseline, current })
  const use = new Map(copyTerms.map(term => [term.id, term.use]))
  use.set('plugin-prefix', 'the view name alone')
  if (increased.length > 0) {
    console.error('copy-check: banned glossary terms increased in UI copy (docs/ade-ux/README.md §3 Glossary):')
    for (const line of increased) console.error(`  ${line} — use "${use.get(line.split(':')[0] ?? '') ?? ''}"`)
    console.error('Run `node --run check:copy -- --report` to list findings and fix the new copy.')
    process.exitCode = 1
    return
  }
  console.log(`copy-check: ${findings.length} findings, none above the baseline.`)
  if (decreased.length > 0) {
    console.log('Fewer findings than the baseline; ratchet it down with `node --run check:copy -- --update`:')
    for (const line of decreased) console.log(`  ${line}`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
