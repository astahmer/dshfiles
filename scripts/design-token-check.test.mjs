import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DesignTokenCheck } from './design-token-check.ts'

const { compare, countByRuleAndPlugin, findingsInText, isSource, isTokenFile } = DesignTokenCheck

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
