// Design-token check: off-scale styling in plugin sources, as a ratchet (visual refresh T4.1, unslop guardrails).
//
// DESIGN.md names one scale for type, radius, colour, elevation and motion, generated in `plugin-ui` and `ui-styles`.
// This script counts what bypasses it, per rule and per plugin, in every owned and forked plugin's `src` (tests,
// generated files and the token files themselves excluded):
//
//   arbitrary-text            `text-[…]` utilities (a size or colour off the type scale)
//   arbitrary-radius          `rounded-[…]` utilities and literal `border-radius: <n>px` in CSS
//   raw-colour                hex, rgb()/rgba(), hsl()/hsla() and oklch() literals outside the token files
//   native-icons              `Icon…OutlineRegular` imports (the native icon family; lucide is the one family)
//   default-shadow            Tailwind's shadow steps (`shadow-xs..2xl`) instead of the elevation steps `shadow-s0..s3`
//   numeric-duration          `duration-<n>` instead of a `--dshx-duration-*` token
//   viewport-variant          window breakpoints (`sm:`…`2xl:`, `max-*`) in a pane; a dialog's `max-w-*` is allowed
//   solid-status-fill         solid `bg-info|success|warning` (or a status/health role) outside the kit
//   chart-hue                 `chart-1..5` classes outside the chart component (identity and data have their own tones)
//   palette-colour            numbered Tailwind palette classes (`bg-emerald-500`)
//   uppercase                 `uppercase` and `text-transform: uppercase`
//   local-duration-formatter  a `formatElapsed`/`formatDuration`/`formatClock` defined outside the kit's `lib`, and a
//                             `padStart(2, '0')` on a line that prints a time unit (`}s`, `}m`, `}h`)
//   unguarded-loop-animation  spin or pulse with no `motion-reduce:`/`motion-safe:` class in the same list
//   outline-without-focus     a control's `outline-none` with no `focus-visible:` replacement in the same list
//   faint-focus-ring          `ring-ring/50`, the retired 3px halo; the kit sheet draws the one focus ring
//
// It fails only when a rule's count for one plugin rises above `scripts/design-token-check.baseline.json`, so the
// burn-down can land plugin by plugin while new code stays on the tokens.
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

/** The kit's duration grammar lives here; DESIGN.md › Durations. */
const durationModuleDirectory = 'plugins/@dshfiles/plugin-ui/src/lib/'

/** A definition of a duration formatter name: `const formatClock =`, `function formatElapsed(`, `static formatDuration =`. */
const durationFormatterName = /(?:\bfunction\s+|\b(?:const|let|var)\s+|\bstatic\s+(?:readonly\s+)?)(formatElapsed|formatDuration|formatClock)\b/

/**
 * A definition that formats nothing itself: an alias of another function, a one-line wrapper that calls the kit, or a
 * clock-time formatter (a `Date`), which prints a time of day rather than a duration.
 */
const notAFormatter = /=\s*[\w.]+\s*$|=.*\b(?:formatElapsed|formatDurationMs)\(|\bDate\b|toLocale(?:Date|Time)?String\(|DateTimeFormat/

/**
 * A printed duration unit right after an interpolation (`${s}s`, `${m}m`, `${h} h`). A time of day (`${hh}:${mm}`) and
 * a UTC offset print none, so their padding is not counted.
 */
const timeUnit = /\}\s?(?:ms|s|m|h|min|sec)\b/

export interface ClassToken {
  /** The whole class as written, `dshx:hover:md:shadow-sm`. */
  readonly text: string
  /** Its variants in order, `['hover', 'md']`. */
  readonly variants: readonly string[]
  /** The utility after the last variant, `shadow-sm`, with a leading or trailing `!` dropped. */
  readonly utility: string
}

/** Split on the colons outside brackets and parentheses (`[&:hover]:`, `text-[length:calc(…)]` keep theirs). */
const splitVariants = (body: string): readonly string[] => {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if (char === '[' || char === '(') depth += 1
    else if (char === ']' || char === ')') depth -= 1
    if (char === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

/** The `dshx:`-prefixed Tailwind classes on one line, parsed into variants and utility. */
const classTokens = (line: string): readonly ClassToken[] =>
  [...line.matchAll(/(?<![\w:-])dshx:[^\s'"`]+/g)].map(match => {
    const parts = splitVariants(match[0].slice('dshx:'.length))
    return { text: match[0], variants: parts.slice(0, -1), utility: (parts.at(-1) ?? '').replace(/^!|!$/g, '') }
  })

/** Classes on the line whose parsed token passes `test`, as excerpts; CSS files hold no classes. */
const classes = (line: string, file: string, test: (token: ClassToken) => boolean): readonly string[] =>
  isCss(file)
    ? []
    : classTokens(line)
        .filter(test)
        .map(token => token.text)

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
  {
    // The kit's @theme maps only shadow-s0..s3 onto the elevation tokens; xs..2xl draw Tailwind's default shadows.
    id: 'default-shadow',
    use: 'an elevation step (dshx:shadow-s1/s2/s3, var(--dshx-elevation-*)), or a border instead of depth',
    matches: (line, file) => classes(line, file, token => /^shadow-(?:2xs|xs|sm|md|lg|xl|2xl)(?:\/[\w.[\]-]+)?$/.test(token.utility)),
  },
  {
    // A number cannot follow the scale when it moves; the duration tokens name the job (hover, fade, menu, panel, sheet).
    id: 'numeric-duration',
    use: 'a duration token (dshx:duration-(--dshx-duration-fade|menu|panel|sheet)), or the kit component that already animates',
    matches: (line, file) => classes(line, file, token => /^duration-(?:\d+|\[[^\]]+\])$/.test(token.utility)),
  },
  {
    // A plugin renders in a pane, not the window: a split pane at 480 px on a wide screen still gets `md:`. A
    // dialog's `sm:max-w-*` width is the one defensible use (the dialog portals to the window).
    id: 'viewport-variant',
    use: 'a container query (dshx:@container with dshx:@md:…), or the kit component that adapts',
    matches: (line, file) =>
      classes(line, file, token => token.variants.some(variant => /^(?:max-)?(?:sm|md|lg|xl|2xl)$/.test(variant)) && !/^max-w-/.test(token.utility)),
  },
  {
    // Status colour belongs to the kit's StatusGlyph, HealthDot and badges; a plugin's own solid fill invents a tone
    // table. The role names (`status-ready`, `health-down`) count as well; `control-on` is a fill DESIGN.md allows (the
    // on state of a control), so it is not matched.
    id: 'solid-status-fill',
    use: 'StatusGlyph / HealthDot / Badge from the kit, or the tinted trio (dshx:bg-info/10 with var(--dshx-tone-*))',
    matches: (line, file) =>
      file.startsWith('plugins/@dshfiles/plugin-ui/')
        ? []
        : classes(line, file, token => /^bg-(?:info|success|warning|status-(?:needs-you|failed|ready)|health-(?:ok|limited|down))$/.test(token.utility)),
  },
  {
    // `chart-1..5` resolve to indigo, success, warning, danger and grey: as an identity (an agent, a project) or a
    // decoration they read as a status. DESIGN.md › Colour roles 5 and 8: identity-1..8 tell things apart, data-1..6
    // order chart series. The kit's chart component maps the series variables itself.
    id: 'chart-hue',
    use: 'identity-1..8 for a project, agent or provider, data-1..6 for a chart series, or a status role for a status',
    matches: (line, file) =>
      file === 'plugins/@dshfiles/plugin-ui/src/chart.tsx'
        ? []
        : classes(line, file, token =>
            /^(?:bg|text|fill|stroke|border(?:-[trblxyse])?|ring|outline|shadow|from|via|to|decoration|accent|caret|divide)-chart-[1-5](?:\/[\w.[\]-]+)?$/.test(token.utility),
          ),
  },
  {
    // Tailwind's numbered palette (emerald-500) ignores the theme; the kit's own hues (teal, violet) carry no step.
    id: 'palette-colour',
    use: 'a semantic colour (bg-muted, text-info, var(--dshx-tone-*)) or a kit hue (teal, violet, graph-1..6)',
    matches: (line, file) =>
      classes(line, file, token =>
        /^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|shadow|accent|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/[\w.[\]-]+)?$/.test(
          token.utility,
        ),
      ),
  },
  {
    // DESIGN.md › Focus ring: one 2px solid accent outline, drawn by the kit sheet for every control; the 50% halo
    // measured 2.0–2.7:1 (round four, A-F5).
    id: 'faint-focus-ring',
    use: 'nothing: the kit sheet draws the focus ring (add data-focus-inset to a clipping list)',
    matches: (line, file) => classes(line, file, token => token.utility === 'ring-ring/50'),
  },
  {
    // DESIGN.md: labels are sentence case; ALL-CAPS labels are banned. A keyboard key cap is drawn by Kbd.
    id: 'uppercase',
    use: 'sentence case in the copy itself (a type token for the overline style), or Kbd for a key',
    matches: (line, file) => (isCss(file) ? all(/text-transform:\s*uppercase\b/g, line) : classes(line, file, token => token.utility === 'uppercase')),
  },
  {
    // DESIGN.md › Durations: one grammar, so a wait reads the same in the transcript, the dock and a table.
    id: 'local-duration-formatter',
    use: 'formatElapsed or formatDurationMs from @dshfiles/plugin-ui/lib/format-duration',
    matches: (line, file) => {
      if (isCss(file) || file.startsWith(durationModuleDirectory)) return []
      const named = durationFormatterName.exec(line)
      const definition = named?.[1] === undefined || notAFormatter.test(line) ? [] : [named[1]]
      const padded = timeUnit.test(line) ? all(/padStart\(2,\s*['"]0['"]\)/g, line) : []
      return [...definition, ...padded]
    },
  },
]

export interface ClassGroup {
  /** Offset of the group's first literal in the file. */
  readonly index: number
  /** The literals' bodies joined by a space. */
  readonly text: string
  /** The JSX element whose attribute holds the list (`button`, `DropdownMenuTrigger`), when the list is inline. */
  readonly element?: string
  /** Whether that element's open tag says `role="button"` (or another widget role) before the list. */
  readonly widgetRole?: boolean
}

/** Where a class list sits: the JSX element and whether its open tag gives it a widget role. */
type ElementContext = Pick<ClassGroup, 'element' | 'widgetRole'>

/**
 * The JSX element a class list at `index` sits in: the nearest `<Tag` before it whose open tag has not closed. An
 * arrow (`=>`) is not a closing `>`. A list held in a variable (`const inputClass = cn(…)`) has none.
 */
const elementAt = (text: string, index: number): ElementContext => {
  const before = text.slice(Math.max(0, index - 800), index)
  const open = [...before.matchAll(/<([A-Za-z][\w.]*)\b/g)].at(-1)
  if (open === undefined) return {}
  const attributes = before.slice(open.index + open[0].length)
  if (/(?<!=)>|\/>|<\//.test(attributes.replace(/=>/g, ''))) return {}
  return { element: open[1] ?? '', widgetRole: /\brole=["'{]*(?:button|link|tab|menuitem|option|switch|checkbox)\b/.test(attributes) }
}

/**
 * The class lists of a file: each string literal (a template's `${…}` holes included, so their nested strings belong to
 * it), merged with its neighbours when only `,` or `+` separates them, as in `cn('dshx:a', 'dshx:b')`. A line-based
 * check over-reports, because a cn() call spreads one class list over several lines.
 */
const classGroups = (text: string): readonly ClassGroup[] => {
  const literals: { readonly start: number; readonly end: number; readonly body: string }[] = []
  let index = 0
  while (index < text.length) {
    const quote = text[index]
    if (quote !== "'" && quote !== '"' && quote !== '`') {
      index += 1
      continue
    }
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `index` advances past the literal.
    const start = index
    let depth = 0
    index += 1
    while (index < text.length) {
      const char = text[index]
      if (char === '\\') {
        index += 2
        continue
      }
      if (quote === '`') {
        if (char === '$' && text[index + 1] === '{') {
          depth += 1
          index += 2
          continue
        }
        if (char === '}' && depth > 0) depth -= 1
        else if (char === '`' && depth === 0) break
      } else if (char === quote || char === '\n') break
      index += 1
    }
    literals.push({ start, end: index + 1, body: text.slice(start + 1, index) })
    index += 1
  }
  const groups: { index: number; text: string; end: number }[] = []
  for (const literal of literals) {
    const last = groups.at(-1)
    if (last !== undefined && /^\s*[,+]\s*$/.test(text.slice(last.end, literal.start))) {
      last.text += ` ${literal.body}`
      last.end = literal.end
    } else groups.push({ index: literal.start, text: literal.body, end: literal.end })
  }
  return groups.map(group => ({ index: group.index, text: group.text, ...elementAt(text, group.index) }))
}

export interface DesignTokenGroupRule {
  readonly id: string
  readonly use: string
  /** The offending classes of one class group, as excerpts. */
  readonly matches: (group: ClassGroup, file: string) => readonly string[]
}

/** Rules that need a whole class list, not one class: a class is fine only when another in its list compensates. */
export const designTokenGroupRules: readonly DesignTokenGroupRule[] = [
  {
    // DESIGN.md Motion: loops stop under reduced motion. The kit Spinner carries motion-reduce:animate-none.
    id: 'unguarded-loop-animation',
    use: 'the kit Spinner, or add dshx:motion-reduce:animate-none (or write the loop as dshx:motion-safe:animate-*)',
    matches: (group, file) => {
      if (isCss(file) || !/animate-(?:spin|pulse)/.test(group.text)) return []
      const tokens = classTokens(group.text)
      if (tokens.some(token => token.variants.some(variant => variant === 'motion-reduce' || variant === 'motion-safe'))) return []
      return tokens.filter(token => /^animate-(?:spin|pulse)$/.test(token.utility)).map(token => token.text)
    },
  },
  {
    // A hand-built trigger that removes the browser outline must draw a focus ring of its own. Only a control counts
    // (button, link, summary, a *Trigger, or a widget role): a dialog, tab panel or drawer takes programmatic focus with
    // no ring by design, and an input usually sits in a wrapper that draws a focus-within ring.
    id: 'outline-without-focus',
    use: 'the kit Button (asChild for a trigger), or a dshx:focus-visible:ring-* / focus-visible:outline-* in the same list',
    matches: (group, file) => {
      if (isCss(file) || !group.text.includes('outline-none')) return []
      const element = group.element ?? ''
      if (!(/^(?:button|a|summary)$/.test(element) || /Trigger$/.test(element) || group.widgetRole === true)) return []
      const tokens = classTokens(group.text)
      const replaced = tokens.some(
        token => token.variants.some(variant => /focus-(?:visible|within)/.test(variant)) && !/^outline-(?:none|hidden)$/.test(token.utility),
      )
      return replaced ? [] : tokens.filter(token => token.utility === 'outline-none' && token.variants.length === 0).map(token => token.text)
    },
  },
]

/** Files that define the tokens: colour literals there are the palette itself. */
const isTokenFile = (rel: string): boolean =>
  /^plugins\/@dshfiles\/ui-styles\/src\//.test(rel) ||
  /^plugins\/@dshfiles\/plugin-ui\/src\/(?:styles\.css|color-roles\.css|theme\/)/.test(rel) ||
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
  // The comment-free text, line for line, for the group rules.
  const code: string[] = []
  // An icon counts once per file (one import), however often it is drawn.
  const iconsSeen = new Set<string>()
  let inBlockComment = false
  lines.forEach((raw, index) => {
    code.push('')
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
    code[index] = line
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
  if (!isCss(input.file)) {
    const text = code.join('\n')
    // Groups come in file order, so the line number advances with them.
    let line = 1
    let counted = 0
    for (const group of classGroups(text)) {
      for (; counted < group.index; counted += 1) if (text.charCodeAt(counted) === 10) line += 1
      for (const rule of designTokenGroupRules)
        for (const match of rule.matches(group, input.file))
          findings.push({ rule: rule.id, plugin: input.plugin, file: input.file, line, text: match.slice(0, 80) })
    }
  }
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

/** Every finding in the repository's plugins (owned and forked), sorted for stable output. */
const scanRepository = (root: string): readonly DesignTokenFinding[] => {
  const pluginsRoot = join(root, 'plugins/@dshfiles')
  // Vendored forks with no styling delta of ours yet (cordis-cards, deliverables, schedule, settings-subagent) count
  // too: their upstream styling is still debt on our screens, and the baseline keeps it from growing.
  const plugins = readdirSync(pluginsRoot).filter(name => statSync(join(pluginsRoot, name)).isDirectory())
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

const ruleIds = (): readonly string[] => [...designTokenRules, ...designTokenGroupRules].map(rule => rule.id)

const totalsByRule = (findings: readonly DesignTokenFinding[]): Readonly<Record<string, number>> =>
  Object.fromEntries(ruleIds().map(rule => [rule, findings.filter(finding => finding.rule === rule).length]))

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
  static readonly groupRules = designTokenGroupRules
  static readonly classTokens = classTokens
  static readonly classGroups = classGroups
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
  const use = new Map([...designTokenRules, ...designTokenGroupRules].map(rule => [rule.id, rule.use]))
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
