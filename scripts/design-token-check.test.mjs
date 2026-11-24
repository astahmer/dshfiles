import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DesignTokenCheck } from './design-token-check.ts'

const { classGroups, classTokens, compare, countByRuleAndPlugin, findingsInText, isSource, isTokenFile, scanRepository } = DesignTokenCheck

const rulesIn = (file, text) => findingsInText({ plugin: 'demo', file, text }).map(finding => `${finding.rule}:${finding.text}`)

test('counts arbitrary text and radius utilities, not token utilities', () => {
  const source = [
    "const a = cn('dshx:text-[11px] dshx:text-xs dshx:rounded-[2px] dshx:rounded-md')",
    "const b = 'dshx:text-(--dsw-alias-label-tertiary) dshx:rounded-t-[10px] dshx:max-w-[60%]'",
  ].join('\n')
  assert.deepEqual(rulesIn('plugins/@dshfiles/demo/src/a.tsx', source), [
    'arbitrary-text:text-[11px]',
    'arbitrary-radius:rounded-[2px]',
    'arbitrary-radius:rounded-t-[10px]',
  ])
})

test('counts literal CSS radii except pills, zero and variables', () => {
  const css = [
    '.a { border-radius: 10px; }',
    '.b { border-radius: var(--dsw-radius-sm); }',
    '.c { border-radius: 999px; }',
    '.d { border-radius: 0; }',
    '.e { border-top-left-radius: 6px; }',
  ].join('\n')
  assert.deepEqual(rulesIn('plugins/@dshfiles/demo/src/a.module.css', css), [
    'arbitrary-radius:border-radius: 10px',
    'arbitrary-radius:border-top-left-radius: 6px',
  ])
})

test('counts raw colours outside token files and comments, and each native icon once per file', () => {
  const source = [
    '// #ffffff in a comment',
    '/* rgba(0, 0, 0, 0.5) */ const x = "#10A37F"',
    'const y = `oklch(0.5 0.1 200)` + "#L24" + "&#123;"',
    "import { IconArchiveOutlineRegular } from '@deepseek-ai/icons'",
    'const z = <IconArchiveOutlineRegular />',
  ].join('\n')
  assert.deepEqual(rulesIn('plugins/@dshfiles/demo/src/a.tsx', source), ['raw-colour:#10A37F', 'raw-colour:oklch(0', 'native-icons:IconArchiveOutlineRegular'])
  assert.deepEqual(rulesIn('plugins/@dshfiles/ui-styles/src/theme.generated.css', ':root { --x: oklch(0.5 0.1 65); }'), [])
  assert.ok(isTokenFile('plugins/@dshfiles/plugin-ui/src/styles.css'))
  assert.ok(isTokenFile('plugins/@dshfiles/plugin-ui/src/color-roles.css'))
  assert.equal(isTokenFile('plugins/@dshfiles/plugin-ui/src/components/ui/button.tsx'), false)
})

test('scans sources only', () => {
  assert.ok(isSource('plugins/@dshfiles/demo/src/a.tsx'))
  assert.ok(isSource('plugins/@dshfiles/demo/src/a.module.css'))
  assert.equal(isSource('plugins/@dshfiles/demo/src/a.test.tsx'), false)
  assert.equal(isSource('plugins/@dshfiles/demo/src/tests/fixture.ts'), false)
  assert.equal(isSource('plugins/@dshfiles/demo/src/a.d.ts'), false)
})

test('ratchets per rule and plugin, so one plugin cannot hide another', () => {
  const current = countByRuleAndPlugin([
    { rule: 'raw-colour', plugin: 'a', file: 'x', line: 1, text: '#fff' },
    { rule: 'raw-colour', plugin: 'a', file: 'x', line: 2, text: '#000' },
  ])
  assert.deepEqual(current, { 'raw-colour/a': 2 })
  const result = compare({ baseline: { 'raw-colour/a': 1, 'raw-colour/b': 5 }, current })
  assert.deepEqual(result.increased, ['raw-colour/a: 2 > baseline 1'])
  assert.deepEqual(result.decreased, ['raw-colour/b: 0 < baseline 5'])
})

const ruleHits = (rule, text, file = 'plugins/@dshfiles/demo/src/a.tsx') =>
  findingsInText({ plugin: 'demo', file, text })
    .filter(finding => finding.rule === rule)
    .map(finding => finding.text)

test('parses dshx classes into variants and utility, keeping colons inside brackets', () => {
  assert.deepEqual(
    classTokens("cn('dshx:hover:md:shadow-sm dshx:[&:hover]:flex dshx:text-[length:calc(var(--x)-1px)] dshx:shadow-md!')").map(token => [
      token.variants,
      token.utility,
    ]),
    [
      [['hover', 'md'], 'shadow-sm'],
      [['[&:hover]'], 'flex'],
      [[], 'text-[length:calc(var(--x)-1px)]'],
      [[], 'shadow-md'],
    ],
  )
})

test('default-shadow: Tailwind shadow steps, not the elevation steps', () => {
  assert.deepEqual(ruleHits('default-shadow', "cn('dshx:shadow-sm dshx:hover:shadow-lg dshx:shadow-s2 dshx:shadow-none dshx:shadow-md/20 shadow-xl')"), [
    'dshx:shadow-sm',
    'dshx:hover:shadow-lg',
    'dshx:shadow-md/20',
  ])
})

test('numeric-duration: a number or an arbitrary time, not a motion token', () => {
  assert.deepEqual(
    ruleHits('numeric-duration', "cn('dshx:duration-200 dshx:hover:duration-[350ms] dshx:duration-(--dshx-duration-fade) dshx:transition-opacity')"),
    ['dshx:duration-200', 'dshx:hover:duration-[350ms]'],
  )
})

test('viewport-variant: window breakpoints, not container queries or dialog widths', () => {
  assert.deepEqual(ruleHits('viewport-variant', "cn('dshx:md:text-sm dshx:max-sm:hidden dshx:hover:lg:flex dshx:@md:flex dshx:sm:max-w-lg dshx:smooth')"), [
    'dshx:md:text-sm',
    'dshx:max-sm:hidden',
    'dshx:hover:lg:flex',
  ])
})

test('solid-status-fill: a solid info, success or warning fill outside the kit', () => {
  const line = "cn('dshx:bg-success dshx:hover:bg-warning dshx:bg-info/10 dshx:bg-success-foreground dshx:text-success dshx:bg-destructive')"
  assert.deepEqual(ruleHits('solid-status-fill', line), ['dshx:bg-success', 'dshx:hover:bg-warning'])
  assert.deepEqual(ruleHits('solid-status-fill', line, 'plugins/@dshfiles/plugin-ui/src/components/ui/badge.tsx'), [])
})

test('solid-status-fill: the status and health role names count too; the control on state is an allowed fill', () => {
  const line = "cn('dshx:bg-status-ready dshx:bg-health-down dshx:bg-status-working dshx:data-[state=checked]:bg-control-on dshx:bg-identity-3')"
  assert.deepEqual(ruleHits('solid-status-fill', line), ['dshx:bg-status-ready', 'dshx:bg-health-down'])
})

test('chart-hue: chart-1..5 classes outside the chart component, not data or identity tones', () => {
  const line = "cn('dshx:bg-chart-1/15 dshx:text-chart-3 dshx:fill-chart-2 dshx:bg-data-2 dshx:text-identity-4 dshx:[--ts-chart-1:var(--x)]')"
  assert.deepEqual(ruleHits('chart-hue', line), ['dshx:bg-chart-1/15', 'dshx:text-chart-3', 'dshx:fill-chart-2'])
  assert.deepEqual(ruleHits('chart-hue', line, 'plugins/@dshfiles/plugin-ui/src/chart.tsx'), [])
})

test('palette-colour: numbered Tailwind palette classes, not semantic colours or kit hues', () => {
  assert.deepEqual(
    ruleHits(
      'palette-colour',
      "cn('dshx:bg-emerald-500 dshx:dark:text-red-400/80 dshx:border-l-amber-300 dshx:bg-teal dshx:text-violet dshx:bg-muted dshx:text-info')",
    ),
    ['dshx:bg-emerald-500', 'dshx:dark:text-red-400/80', 'dshx:border-l-amber-300'],
  )
})

test('uppercase: the class and the CSS declaration, not other text transforms', () => {
  assert.deepEqual(ruleHits('uppercase', "cn('dshx:uppercase dshx:md:uppercase dshx:capitalize dshx:normal-case')"), ['dshx:uppercase', 'dshx:md:uppercase'])
  assert.deepEqual(ruleHits('uppercase', '.a { text-transform: uppercase; }\n.b { text-transform: none; }', 'plugins/@dshfiles/demo/src/a.module.css'), [
    'text-transform: uppercase',
  ])
})

test('class groups join the literals of one cn() call across lines, holes included', () => {
  const source = [
    'cn(',
    "  'dshx:animate-spin',",
    "  'dshx:motion-reduce:animate-none',",
    ')',
    "const other = 'dshx:size-4'",
    'const t = `dshx:flex ${open ? "dshx:block" : ""}`',
  ].join('\n')
  assert.deepEqual(
    classGroups(source).map(group => group.text),
    ['dshx:animate-spin dshx:motion-reduce:animate-none', 'dshx:size-4', 'dshx:flex ${open ? "dshx:block" : ""}'],
  )
})

test('unguarded-loop-animation: spin or pulse with no motion variant in the same class list', () => {
  const source = [
    "const a = cn('dshx:animate-spin dshx:size-4')",
    "const b = cn('dshx:animate-pulse',",
    "  'dshx:motion-reduce:animate-none')",
    "const c = 'dshx:motion-safe:animate-spin'",
    "// const d = 'dshx:animate-spin'",
  ].join('\n')
  assert.deepEqual(
    findingsInText({ plugin: 'demo', file: 'plugins/@dshfiles/demo/src/a.tsx', text: source })
      .filter(finding => finding.rule === 'unguarded-loop-animation')
      .map(finding => `${finding.line}:${finding.text}`),
    ['1:dshx:animate-spin'],
  )
})

test('outline-without-focus: a control with outline-none and no focus-visible replacement in the same class list', () => {
  const source = [
    '<button type="button" className="dshx:outline-none dshx:rounded-md" onClick={() => go()}>Go</button>',
    "<DropdownMenuTrigger className={cn('dshx:outline-none',",
    "  'dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring')} />",
    '<div role="button" tabIndex={0} className="dshx:outline-none dshx:has-[:focus-visible]:outline-none" />',
    '<a href="#x" className="dshx:outline-none dshx:group-focus-within:ring-1">x</a>',
    '<div tabIndex={-1} className="dshx:outline-none">panel</div>',
    '<input className="dshx:outline-none dshx:bg-transparent" />',
    "const inputClass = cn('dshx:outline-none dshx:w-full')",
  ].join('\n')
  assert.deepEqual(
    findingsInText({ plugin: 'demo', file: 'plugins/@dshfiles/demo/src/a.tsx', text: source })
      .filter(finding => finding.rule === 'outline-without-focus')
      .map(finding => `${finding.line}:${finding.text}`),
    ['1:dshx:outline-none', '4:dshx:outline-none'],
  )
})

test('counts vendored forks with the owned plugins instead of skipping them', () => {
  const root = mkdtempSync(join(tmpdir(), 'design-token-check-'))
  try {
    for (const plugin of ['schedule', 'backlog']) {
      mkdirSync(join(root, 'plugins/@dshfiles', plugin, 'src'), { recursive: true })
      writeFileSync(join(root, 'plugins/@dshfiles', plugin, 'src/a.module.css'), '.a { border-radius: 6px; }\n')
    }
    assert.deepEqual(countByRuleAndPlugin(scanRepository(root)), { 'arbitrary-radius/backlog': 1, 'arbitrary-radius/schedule': 1 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('counts a duration formatted outside the kit, not a call to the kit or a wall clock', () => {
  const source = [
    "const formatElapsed = (ms: number): string => {",
    "  const total = Math.floor(ms / 1000)",
    "  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`",
    '}',
    'function formatClock(seconds: number) {',
    "  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`",
    '}',
    'export const formatDuration = (ms: number | null): string => (ms === null ? "—" : formatDurationMs(ms))',
    "const formatClock = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit' })",
    "const id = String(index).padStart(2, '0')",
    "const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`",
    'static readonly formatElapsed = formatElapsed',
    'static readonly formatDuration = (input: { readonly ms: number }): string => {',
  ].join('\n')
  assert.deepEqual(rulesIn('plugins/@dshfiles/demo/src/a.tsx', source), [
    'local-duration-formatter:formatElapsed',
    "local-duration-formatter:padStart(2, '0')",
    'local-duration-formatter:formatClock',
    'local-duration-formatter:formatDuration',
  ])
  assert.deepEqual(rulesIn('plugins/@dshfiles/plugin-ui/src/lib/format-duration.ts', source), [])
  assert.deepEqual(rulesIn('plugins/@dshfiles/demo/src/a.module.css', '.a { --formatDuration: 1; }'), [])
})
