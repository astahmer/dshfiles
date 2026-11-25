/**
 * Round five A7: the core Plugins page (DSH's own, no fork here) takes the shared page inset, icon tiles on identity
 * tones at a 14% fill, and a quiet neutral "Experimental" chip shown once per group. ui-styles restyles it through the
 * page's stable hooks: `data-plugin-*` attributes, the Tag primitive's `data-tone`, and the CSS-module class names'
 * stable suffixes (`X_2TxG_cardIcon` → `_cardIcon`). This guard fails when a DSH bump renames one of those hooks, or when
 * a rule would no longer out-rank the module rule it overrides.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(join(process.cwd(), 'package.json'))
const dsh = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const web = createRequire(dsh.resolve('@deepseek-ai/dsh-web-app/package.json'))
const page = readFileSync(join(dirname(web.resolve('@deepseek-ai/dsh-client-ui-plugin-manager/package.json')), 'lib/client.js'), 'utf8')
const primitives = dirname(dsh.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json'))
const tagSheet = readFileSync(join(primitives, 'lib/Tag.module.css'), 'utf8')
const client = readFileSync(join(process.cwd(), 'src/client.css'), 'utf8')
const sheet = (() => {
  try {
    return readFileSync(join(process.cwd(), 'src/core-plugins.css'), 'utf8')
  } catch {
    return ''
  }
})()

/** Every rule of the override sheet, comments removed: [selector list, body]. */
const rules = [...sheet.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}@]+)\{([^{}]*)\}/gu)].map(([, selector = '', body = '']) => [selector.trim(), body] as const)
const ruleFor = (needle: string): string => {
  // A needle ending in ' {' must end the selector list.
  const exact = needle.endsWith(' {') ? needle.slice(0, -2) : undefined
  return rules.find(([selector]) => (exact === undefined ? selector.includes(needle) : selector.endsWith(exact)))?.[1] ?? ''
}

/** (ids, classes + attributes + pseudo-classes, types) of one simple selector chain, enough for these rules. */
function specificity(selector: string): readonly [number, number, number] {
  const attrs = selector.match(/\[[^\]]+\]|\.[\w-]+|:(?!not|has|is|where)[\w-]+/gu)?.length ?? 0
  const types = selector.replace(/\[[^\]]+\]|\([^)]*\)/gu, '').match(/(?:^|[\s>+~])([a-z][\w-]*)/gu)?.length ?? 0
  return [0, attrs, types]
}
const beats = (a: readonly number[], b: readonly number[]): boolean => a[1]! > b[1]! || (a[1] === b[1] && a[2]! > b[2]!)

describe('core Plugins page (round five A7)', () => {
  it('still renders the hooks the override sheet keys on', () => {
    // Booleans, not toContain: a failure would print the whole Host bundle.
    for (const hook of ['data-plugin-panel', 'data-plugin-body', 'data-plugin-group', 'data-plugin-package', '"data-tone"']) expect(page.includes(hook), hook).toBe(true)
    for (const name of ['page', 'pageBody', 'pageBar', 'pageHead', 'cardIcon', 'cardOpen', 'statusTag'])
      expect(new RegExp(`"${name}":\\s*\`[A-Za-z0-9]+_[A-Za-z0-9]+_${name}\``, 'u').test(page), name).toBe(true)
    expect(page.includes('--plugin-page-inset:clamp(24px, 4vw, 48px)'), 'page inset').toBe(true)
    expect(/_page>\*\{flex:none;width:100%;max-width:960px\}/u.test(page), 'page column').toBe(true)
    expect(tagSheet).toContain(".tag[data-tone='info']")
  })

  it('is imported once by the shared sheet, unlayered like the Host module sheets', () => {
    expect(client.match(/@import '\.\/core-plugins\.css';/gu)).toHaveLength(1)
    expect(sheet).not.toMatch(/@layer/u)
  })

  it('aligns the page frame to the shared 24px inset (12px narrow), filling the pane instead of a centred 960px column', () => {
    const frame = ruleFor('[data-plugin-panel][data-plugin-panel]')
    expect(frame).toMatch(/--plugin-page-inset:\s*24px;/u)
    expect(frame).toMatch(/--plugin-page-top-inset:\s*24px;/u)
    expect(frame).toMatch(/align-items:\s*stretch;/u)
    expect(sheet).toMatch(/@media \(width < 28rem\)\s*\{\s*section\[data-plugin-panel\]\[data-plugin-panel\]\s*\{\s*--plugin-page-inset:\s*12px;/u)
    const columns = ruleFor("[class*='_pageBody'] > *")
    expect(columns).toMatch(/max-width:\s*none;/u)
    // The module rules are (0,1,0) and (0,2,0); every override out-ranks them.
    for (const [selector] of rules) for (const part of selector.split(',')) expect(beats(specificity(part.trim()), [0, 2, 0]), part).toBe(true)
  })

  it('puts the icon tiles on identity tones at a 14% fill, the artwork drawn in the tile tone, with no border', () => {
    const tile = ruleFor("[class*='_cardIcon'] {")
    expect(tile).toMatch(/background:\s*color-mix\(in oklab, var\(--dshx-plugin-tone\) 14%, transparent\);/u)
    expect(tile).toMatch(/border-color:\s*transparent;/u)
    expect(tile).toMatch(/overflow:\s*hidden;/u)
    // The artwork's silhouette, shifted back into the tile as a drop shadow in the tone; the original is clipped away.
    const art = ruleFor("[class*='_cardIcon'] > *")
    expect(art).toMatch(/filter:\s*drop-shadow\(var\(--dshx-plugin-tile-shift\) 0 0 var\(--dshx-plugin-tone\)\);/u)
    expect(art).toMatch(/transform:\s*translateX\(calc\(-1 \* var\(--dshx-plugin-tile-shift\)\)\);/u)
    for (let n = 1; n <= 8; n += 1) expect(sheet, `tone ${n}`).toContain(`li:nth-child(8n + ${n}) { --dshx-plugin-tone: var(--dshx-identity-${n}); }`)
  })

  it('draws Experimental as a quiet neutral chip, once per group when every row is experimental', () => {
    const chip = ruleFor("[class*='_statusTag'][data-tone='info']")
    expect(chip).toMatch(/background:\s*var\(--dsw-alias-bg-module-platform\);/u)
    expect(chip).toMatch(/color:\s*var\(--dsw-alias-label-secondary\);/u)
    const once = rules.find(([selector]) => selector.includes(':has('))
    expect(once?.[0]).toContain(
      "[data-plugin-group]:not(:has(li[data-plugin-package] [class*='_cardOpen']:last-child, li[data-plugin-package] [class*='_cardOpen'] + [class*='_statusTag']:not([data-tone='info'])))",
    )
    // `:has()` cannot nest: a browser drops the whole rule (round five capture showed the chip on every row).
    for (const [selector] of rules) expect(/:has\([^)]*:has\(/u.test(selector), selector).toBe(false)
    expect(once?.[1]).toMatch(/display:\s*none;/u)
  })
})
