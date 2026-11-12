// Design-token check: off-scale styling in plugin sources, as a ratchet (visual refresh T4.1).
//
// DESIGN.md names one scale for type, radius and colour, generated in `plugin-ui` and `ui-styles`. This script counts
// what bypasses it, per rule and per plugin, in every owned and forked plugin's `src` (tests, generated files and the
// token files themselves excluded):
//
//   arbitrary-text    `text-[…]` utilities (a size or colour off the type scale)
//   arbitrary-radius  `rounded-[…]` utilities and literal `border-radius: <n>px` in CSS
//   raw-colour        hex, rgb()/rgba(), hsl()/hsla() and oklch() literals outside the token files
//   native-icons      `Icon…OutlineRegular` imports (the native icon family; lucide is the one family)
//
// It fails only when a rule's count for one plugin rises above `scripts/design-token-check.baseline.json`, so the
// burn-down (T4.2–T4.3) can land plugin by plugin while new code stays on the tokens.
//
//   node --run check:design-tokens             # compare with the baseline; fail on an increase
//   node --run check:design-tokens -- --report # list every finding
//   node --run check:design-tokens -- --update # write the current counts (ratchet down after a fix)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'
import { ScriptJson } from './json.ts'

export interface DesignTokenRule {
  readonly id: string
  /** What to use instead, printed when the rule's count rises. */
  readonly use: string
  /** Every match in one source line; the matched text is the finding's excerpt. */
  readonly matches: (line: string, file: string) => readonly string[]
}

const isCss = (file: string): boolean => file.endsWith('.css')

const all = (pattern: RegExp, line: string): readonly string[] => [...line.matchAll(pattern)].map(match => match[0])

export const designTokenRules: readonly DesignTokenRule[] = [
  {
    id: 'arbitrary-text',
    use: 'a type token (dshx:text-xs/sm/base, text-title, text-display) or a semantic colour',
    matches: (line, file) => (isCss(file) ? [] : all(/(?<![\w-])text-\[[^\]\s]+\]/g, line)),
  },
  {
    id: 'arbitrary-radius',
    use: 'the radius scale (rounded-sm/md/lg/xl/2xl, var(--dsw-radius-*))',
    matches: (line, file) =>
      isCss(file)
        ? // `0`, `inherit`, `var(...)`, `999px`/`50%` pills are on the scale; any other literal is not.
          all(/border(?:-[a-z]+)*-radius:\s*(?!0\s*[;}]|0px\s*[;}]|var\(|inherit|999px|9999px|50%)[0-9.]+(?:px|rem|em)\b[^;}]*/g, line)
        : all(/(?<![\w-])rounded(?:-[a-z]{1,2})?-\[[^\]\s]+\]/g, line),
  },
  {
    id: 'raw-colour',
    use: 'a semantic colour (bg-muted, text-info, var(--dshx-tone-*), var(--dsw-alias-*))',
    matches: line => all(/(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?|oklch)\(\s*[0-9.]/g, line),
  },
  {
    id: 'native-icons',
    use: 'the lucide icon from @dshfiles/plugin-ui/icons',
    matches: (line, file) => (isCss(file) ? [] : all(/\bIcon[A-Z]\w*OutlineRegular\b/g, line)),
  },
]

/** Files that define the tokens: colour literals there are the palette itself. */
const isTokenFile = (rel: string): boolean =>
  /^plugins\/@dshfiles\/ui-styles\/src\//.test(rel) ||
  /^plugins\/@dshfiles\/plugin-ui\/src\/(?:styles\.css|theme\/)/.test(rel) ||
  /\.generated\.(?:css|ts)$/.test(rel)

const isSource = (rel: string): boolean =>
  /\.(?:tsx?|css)$/.test(rel) &&
  !/\.d\.ts$/.test(rel) &&
  !/\.(?:test|spec|characterization\.test)\.tsx?$/.test(rel) &&
  !/(?:^|\/)(?:tests?|__tests__|e2e)\//.test(rel)

export interface DesignTokenFinding {
  readonly rule: string
  readonly plugin: string
  readonly file: string
  readonly line: number
  readonly text: string
}

/** Findings in one file's text; comment-only lines are skipped (they describe colours, they do not paint them). */
const findingsInText = (input: { readonly plugin: string; readonly file: string; readonly text: string }): readonly DesignTokenFinding[] => {
  const findings: DesignTokenFinding[] = []
  const lines = input.text.split('\n')
  // An icon counts once per file (one import), however often it is drawn.
  const iconsSeen = new Set<string>()
  let inBlockComment = false
  lines.forEach((raw, index) => {
    let line = raw
    if (inBlockComment) {
      const end = line.indexOf('*/')
      if (end === -1) return
      line = line.slice(end + 2)
      inBlockComment = false
    }
    // Drop `/* … */` spans on the line, then an unterminated opener starts a block comment.
    line = line.replace(/\/\*.*?\*\//g, ' ')
    const open = line.indexOf('/*')
    if (open !== -1) {
      line = line.slice(0, open)
      inBlockComment = true
    }
    if (/^\s*\/\//.test(line)) return
    for (const rule of designTokenRules) {
      if (rule.id === 'raw-colour' && isTokenFile(input.file)) continue
      for (const match of rule.matches(line, input.file)) {
        if (rule.id === 'native-icons') {
          if (iconsSeen.has(match)) continue
          iconsSeen.add(match)
        }
        findings.push({ rule: rule.id, plugin: input.plugin, file: input.file, line: index + 1, text: match.trim().slice(0, 80) })
      }
    }
  })
  return findings
}

const walk = (directory: string, files: string[]): void => {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__snapshots__') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) walk(path, files)
    else files.push(path)
  }
}

/**
 * Whole native Loader rows vendored from upstream as forks that carry no styling delta of ours yet, so their native
 * styling is upstream's and is not counted. They arrived with the 2026-11-11 upstream merge
 * (the 2026-11-11 upstream merge); move one out of this set when its first styling delta lands, and tokenise it then.
 * `sidebar-terminal` left the set with its restyle (upstream UI fit). `deliverables` (the native changed-files
 * card, forked upstream for image previews) arrived with the 2026-11-12 merge (the 2026-11-12 upstream merge) and waits
 * for the same UI-fit step.
 */
export const VENDORED_UNSTYLED_FORKS: ReadonlySet<string> = new Set(['cordis-cards', 'deliverables', 'schedule', 'settings-subagent'])

/** Every finding in the repository's plugins (owned and forked), sorted for stable output. */
const scanRepository = (root: string): readonly DesignTokenFinding[] => {
  const pluginsRoot = join(root, 'plugins/@dshfiles')
  const plugins = readdirSync(pluginsRoot).filter(name => statSync(join(pluginsRoot, name)).isDirectory() && !VENDORED_UNSTYLED_FORKS.has(name))
  const findings: DesignTokenFinding[] = []
  for (const plugin of plugins) {
    const files: string[] = []
    try {
      walk(join(pluginsRoot, plugin, 'src'), files)
    } catch {
      // A package without src has no styling.
    }
    for (const file of files) {
      const rel = relative(root, file)
      if (!isSource(rel)) continue
      findings.push(...findingsInText({ plugin, file: rel, text: readFileSync(file, 'utf8') }))
    }
  }
  return findings.toSorted((left, right) => left.rule.localeCompare(right.rule) || left.file.localeCompare(right.file) || left.line - right.line)
}

/** Counts keyed `rule/plugin`, so a fix in one plugin cannot hide a regression in another. */
const countByRuleAndPlugin = (findings: readonly DesignTokenFinding[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const finding of findings) {
    const key = `${finding.rule}/${finding.plugin}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)))
}

const totalsByRule = (findings: readonly DesignTokenFinding[]): Readonly<Record<string, number>> =>
  Object.fromEntries(designTokenRules.map(rule => [rule.id, findings.filter(finding => finding.rule === rule.id).length]))

export interface DesignTokenComparison {
  readonly increased: readonly string[]
  readonly decreased: readonly string[]
}

const compare = (input: { readonly baseline: Readonly<Record<string, number>>; readonly current: Readonly<Record<string, number>> }): DesignTokenComparison => {
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

const baselineSchema = Schema.Struct({ totals: Schema.Record(Schema.String, Schema.Number), counts: Schema.Record(Schema.String, Schema.Number) })

/** The design-token check's pure parts, exported for its tests. */
export class DesignTokenCheck {
  static readonly rules = designTokenRules
  static readonly isTokenFile = isTokenFile
  static readonly isSource = isSource
  static readonly findingsInText = findingsInText
  static readonly scanRepository = scanRepository
  static readonly countByRuleAndPlugin = countByRuleAndPlugin
  static readonly totalsByRule = totalsByRule
  static readonly compare = compare
}

const main = (): void => {
  const argv = process.argv.slice(2)
  // `--root <dir>` scans another tree (an exported revision) against this checkout's baseline.
  const rootIndex = argv.indexOf('--root')
  const root = rootIndex === -1 ? fileURLToPath(new URL('..', import.meta.url)) : (argv[rootIndex + 1] ?? '.')
  const baselineUrl = new URL('./design-token-check.baseline.json', import.meta.url)
  const findings = scanRepository(root)
  const current = countByRuleAndPlugin(findings)
  const args = new Set(argv)
  if (args.has('--report')) for (const finding of findings) console.log(`${finding.rule}\t${finding.file}:${finding.line}\t${finding.text}`)
  if (args.has('--update')) {
    writeFileSync(baselineUrl, `${JSON.stringify({ totals: totalsByRule(findings), counts: current }, null, 2)}\n`)
    console.log(`design-token-check: baseline written (${findings.length} findings).`)
    return
  }
  const baseline = ScriptJson.decodeJson(baselineSchema, readFileSync(baselineUrl, 'utf8')).counts
  const { increased, decreased } = compare({ baseline, current })
  const use = new Map(designTokenRules.map(rule => [rule.id, rule.use]))
  if (increased.length > 0) {
    console.error('design-token-check: off-scale styling increased (DESIGN.md tokens; visual refresh T4.1):')
    for (const line of increased) console.error(`  ${line} — use ${use.get(line.split('/')[0] ?? '') ?? 'a token'}`)
    console.error('Run `node --run check:design-tokens -- --report` to list findings and move the new styling onto tokens.')
    process.exitCode = 1
    return
  }
  const totals = totalsByRule(findings)
  console.log(
    `design-token-check: ${findings.length} findings (${Object.entries(totals)
      .map(([rule, count]) => `${rule} ${count}`)
      .join(', ')}), none above the baseline.`,
  )
  if (decreased.length > 0) {
    console.log('Fewer findings than the baseline; ratchet it down with `node --run check:design-tokens -- --update`:')
    for (const line of decreased) console.log(`  ${line}`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
