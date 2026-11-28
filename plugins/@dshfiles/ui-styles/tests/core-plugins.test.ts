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

  it('aligns the page frame to the shared 24px inset (12px narrow), with the list in the 880px lane frame on the header edge', () => {
    const frame = ruleFor('[data-plugin-panel][data-plugin-panel]')
    expect(frame).toMatch(/--plugin-page-inset:\s*24px;/u)
    expect(frame).toMatch(/--plugin-page-top-inset:\s*24px;/u)
    expect(frame).toMatch(/align-items:\s*stretch;/u)
    expect(sheet).toMatch(/@media \(width < 28rem\)\s*\{\s*section\[data-plugin-panel\]\[data-plugin-panel\]\s*\{\s*--plugin-page-inset:\s*12px;/u)
    // Council round 5, D5: the list and the header stop at the kit's 880px lane frame (Page width="lane"), left on the page
    // edge, so the switches sit in a column under the header's actions. The sticky header bar keeps its full width.
    const columns = ruleFor("[class*='_pageBody'] > :not([class*='_pageBar'])")
    expect(columns).toMatch(/max-width:\s*880px;/u)
    expect(ruleFor("[class*='_pageBar'] > [class*='_pageHead']")).toMatch(/max-width:\s*880px;[\s\S]*align-self:\s*flex-start;/u)
    expect(ruleFor("[class*='_pageBody'] {")).toMatch(/align-items:\s*flex-start;/u)
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
  })

  it('picks a tile tone from the plugin name, not its place in the list (council round 3, D4)', () => {
    // CSS cannot hash a string: suffix rules stand in for one, so a row keeps its tone when the list reorders, filters
    // or grows. The cascade is resolved here as a browser would: the last matching rule at equal specificity wins.
    expect(sheet).not.toMatch(/li:nth-child\(8n/u)
    const toneRules = [...sheet.matchAll(/li\[data-plugin-package\$='([^']+)'\], section\[data-plugin-panel\] li\[data-plugin-item\$='\1'\] \{ --dshx-plugin-tone: var\(--dshx-identity-(\d)\); \}/gu)].map(
      ([, suffix = '', tone = '']) => [suffix, Number(tone)] as const,
    )
    const toneOf = (name: string): number | undefined => toneRules.filter(([suffix]) => name.endsWith(suffix)).at(-1)?.[1]
    for (const character of 'abcdefghijklmnopqrstuvwxyz0123456789') expect(toneOf(`-${character}`), character).toBeDefined()
    // The commonest endings never share a tone.
    expect(new Set([...'estnrydl'].map(character => toneOf(`-${character}`))).size).toBe(8)
    // Names from the round-3 capture, most ending in e or -bundle, each take their own tone.
    const names = [
      '@deepseek-ai/dsh-experimental-voice-input-bundle',
      '@deepseek-ai/dsh-hmr-bundle',
      '@deepseek-ai/dsh-plugin-market-index',
      '@deepseek-ai/dsh-experimental-auto-review',
      '@deepseek-ai/dsh-experimental-worktree',
      '@dshfiles/activity-timeline',
      '@dshfiles/agent-communication',
    ]
    expect(new Set(names.map(toneOf)).size).toBe(names.length)
    expect(toneOf('@dshfiles/activity-timeline')).toBe(toneOf('@dshfiles/activity-timeline'))
  })

  it('draws Experimental as a quiet neutral chip, once per group when every row is experimental', () => {
    const chip = ruleFor("[class*='_statusTag'][data-tone='info']")
    expect(chip).toMatch(/background:\s*var\(--dsw-alias-bg-module-platform\);/u)
    expect(chip).toMatch(/color:\s*var\(--dsw-alias-label-secondary\);/u)
    const once = rules.find(([selector]) => selector.includes('[data-plugin-group]:not(:has('))
    expect(once?.[0]).toContain(
      "[data-plugin-group]:not(:has(li[data-plugin-package] [class*='_cardOpen']:last-child, li[data-plugin-package] [class*='_cardOpen'] + [class*='_statusTag']:not([data-tone='info'])))",
    )
    // `:has()` cannot nest: a browser drops the whole rule (round five capture showed the chip on every row).
    for (const [selector] of rules) expect(/:has\([^)]*:has\(/u.test(selector), selector).toBe(false)
    expect(once?.[1]).toMatch(/display:\s*none;/u)
  })

  it('seats icons at 32px, puts the switch in a fixed column and parts rows with a quiet rule (council round 3, D4; round 4, D5)', () => {
    const frame = ruleFor('[data-plugin-panel][data-plugin-panel] {')
    expect(frame).toMatch(/--card-icon-size:\s*32px;/u)
    const end = ruleFor("[class*='_cardEnd']")
    expect(end).toMatch(/min-width:\s*44px;/u)
    expect(end).toMatch(/justify-content:\s*flex-end;/u)
    // A row with no switch keeps the column empty, so every description ends at the same edge.
    expect(ruleFor("[class*='_cardHead']:not(:has([class*='_cardEnd']))::after")).toMatch(/flex:\s*0 0 44px;/u)
    const rule = ruleFor("[class*='_cards'] > li + li::before")
    expect(rule).toMatch(/border-top:\s*1px solid var\(--dsw-alias-border-l3\);/u)
    expect(rule).toMatch(/pointer-events:\s*none;/u)
  })
})

describe('core Plugins rows and section titles (council round 4, D5)', () => {
  it('still renders the hooks these rules key on', () => {
    for (const name of ['cardDesc', 'cardMain', 'sectionTitle', 'groupTitle'])
      expect(new RegExp(`"${name}":\\s*\`[A-Za-z0-9]+_[A-Za-z0-9]+_${name}\``, 'u').test(page), name).toBe(true)
    // The module clamps a description to one line, which cut "an…" and "agent.…" mid-thought.
    expect(/_cardDesc\{[^}]*-webkit-line-clamp:1;/u.test(page), 'one-line clamp').toBe(true)
  })

  it('wraps a description before it clamps (three lines since council round 12, D4)', () => {
    const desc = ruleFor("[class*='_cardDesc']")
    expect(desc).toMatch(/-webkit-line-clamp:\s*3;/u)
    expect(desc).toMatch(/(?<!-webkit-)line-clamp:\s*3;/u)
  })

  it('gives a row without a description the height of a one-line row, so rows are even', () => {
    // Title 20 + gap 4 + one 18px description line.
    expect(ruleFor("[class*='_cardMain']")).toMatch(/min-height:\s*42px;/u)
    expect(ruleFor("[class*='_cardMain']")).toMatch(/justify-content:\s*center;/u)
  })

  it('draws ~18px glyphs in the 32px tiles: the artwork box is 30px, its glyph about 0.6 of it', () => {
    const art = ruleFor("[class*='_cardIcon'] > *")
    expect(art).toMatch(/width:\s*30px;/u)
    expect(art).toMatch(/height:\s*30px;/u)
  })

  it('sets section titles 14/20 at 650', () => {
    for (const hook of ['_sectionTitle', '_groupTitle']) {
      const title = rules.find(([selector]) => selector.includes(`[class*='${hook}']`))?.[1] ?? ''
      expect(title, hook).toMatch(/font-size:\s*14px;/u)
      expect(title, hook).toMatch(/line-height:\s*20px;/u)
      expect(title, hook).toMatch(/font-weight:\s*650;/u)
    }
  })
})

describe('core Plugins navigable rows (council round 5, D5)', () => {
  it('still renders the hooks: a settings row is a card link with no switch, and the Host draws its full-row hover', () => {
    expect(/function ItemCard\(\{[^}]*\}\)\{return[^;]*\.cardLink\}`,"data-plugin-item"/u.test(page), 'item row').toBe(true)
    expect(/_cardLink:hover\{background:var\(--dsw-alias-interactive-bg-hover\)\}/u.test(page), 'row hover').toBe(true)
    expect(/_cardOpen:after\{content:"";[^}]*inset:0\}/u.test(page), 'whole-row target').toBe(true)
  })

  it('ends a row with no switch on a 14px chevron, centred on the switch column axis', () => {
    const chevron = ruleFor("[class*='_cardHead']:not(:has([class*='_cardEnd']))::after")
    expect(chevron).toMatch(/flex:\s*0 0 44px;/u)
    expect(chevron).toMatch(/height:\s*14px;/u)
    expect(chevron).toMatch(/align-self:\s*center;/u)
    // Secondary ink: a glyph at 3:1 or better on the page and on the hover fill in both schemes.
    expect(chevron).toMatch(/background-color:\s*var\(--dsw-alias-label-secondary\);/u)
    // The Host switch (36px) sits flush right in the 44px column: its axis is 18px in, so the 14px chevron ends 11px in.
    expect(chevron).toMatch(/mask:\s*url\("data:image\/svg\+xml,[^"]+"\)\s*right 11px center \/ 14px 14px no-repeat;/u)
  })
})

describe('core Plugins lane (council round 6, D7)', () => {
  // The kit lane caps the CONTENT box at 880px, or 960px when the pane (the Page root, a container with no padding) is
  // 1280px or wider; padding sits outside the cap. Here the pane is `_pageBody`'s border box, whose content box is the
  // pane less the two 24px insets, so "pane >= 1280px" is "content >= 1232px".
  const wide = /@container dshx-plugin-pane \(width >= 1232px\)\s*\{([\s\S]*?)\n\}/u.exec(sheet.replace(/\/\*[\s\S]*?\*\//gu, ''))?.[1] ?? ''

  it('makes the page body the pane container, named so the header bar\'s own container does not answer', () => {
    expect(ruleFor("[class*='_pageBody'] {")).toMatch(/container:\s*dshx-plugin-pane \/ inline-size;/u)
  })

  it('caps the list and the header at 960px of content on a pane of 1280px or more, 880px below', () => {
    expect(ruleFor("[class*='_pageBody'] > :not([class*='_pageBar'])")).toMatch(/max-width:\s*880px;/u)
    expect(wide).toMatch(/section\[data-plugin-panel\] \[class\*='_pageBody'\] > :not\(\[class\*='_pageBar'\]\)[\s\S]*?max-width:\s*960px;/u)
    expect(wide).toMatch(/section\[data-plugin-panel\] \[class\*='_pageBar'\] > \[class\*='_pageHead'\][\s\S]*?max-width:\s*960px;/u)
  })
})

describe('core Plugins page title and descriptions (council round 6, D4)', () => {
  it('still renders the title hook at the module\'s 20/500', () => {
    expect(new RegExp('"pageTitle":\\s*`[A-Za-z0-9]+_[A-Za-z0-9]+_pageTitle`', 'u').test(page), 'pageTitle').toBe(true)
    expect(/_pageTitle\{margin:0;font-size:20px;font-weight:500;line-height:28px\}/u.test(page), 'module title').toBe(true)
  })

  it('sets the h1 like every kit page title: 22/28 at 650, -0.01em', () => {
    const title = ruleFor("[class*='_pageTitle']")
    expect(title).toMatch(/font-size:\s*22px;/u)
    expect(title).toMatch(/line-height:\s*28px;/u)
    expect(title).toMatch(/font-weight:\s*650;/u)
    expect(title).toMatch(/letter-spacing:\s*-0\.01em;/u)
  })

  it('leads each description with a summary line of at most 70ch before it clamps', () => {
    expect(ruleFor("[class*='_cardDesc']")).toMatch(/max-width:\s*70ch;/u)
  })
})

describe('core Plugins multi-line rows (council round 10, D4)', () => {
  it('still renders the hooks: a centred row head, a 20px title line and a 20px Host switch', () => {
    expect(/_cardHead\{align-items:center;/u.test(page), 'centred head').toBe(true)
    expect(/_cardTitle\{[^}]*line-height:20px/u.test(page), 'title line').toBe(true)
    expect(/_cardDesc\{[^}]*line-height:18px/u.test(page), 'description line').toBe(true)
    const switchSheet = readFileSync(join(primitives, 'lib/Switch.module.css'), 'utf8')
    expect(switchSheet).toMatch(/\.switch \{[^}]*height: 20px;/u)
  })

  it('hangs a row with a description from its title line: the switch on the title, the icon at the top', () => {
    // The 20px switch in a 20px end column at the row's top sits on the title's 20px line, however many lines follow.
    const end = ruleFor("li[data-plugin-package] [class*='_cardHead']:has([class*='_cardDesc']:not(:empty)) > [class*='_cardEnd']")
    expect(end).toMatch(/align-self:\s*flex-start;/u)
    expect(end).toMatch(/height:\s*20px;/u)
    expect(ruleFor("li[data-plugin-package] [class*='_cardHead']:has([class*='_cardDesc']:not(:empty)) > [class*='_cardIcon']")).toMatch(/align-self:\s*flex-start;/u)
  })

  it('leaves settings item rows centred: their description slot can render an empty wrapper (HMR updates)', () => {
    const raised = rules.filter(([selector, body]) => /> \[class\*='_card(?:Icon|End)'\]/u.test(selector) && /align-self:\s*flex-start;/u.test(body))
    expect(raised).toHaveLength(2)
    for (const [selector] of raised) expect(selector).toContain('li[data-plugin-package] ')
  })

  it('clamps a description at whole lines, never a partial one', () => {
    expect(ruleFor("[class*='_cardDesc']")).toMatch(/max-height:\s*54px;/u)
  })
})

describe('core Plugins complete summaries (council round 12, D4)', () => {
  it('lets a summary take a third 18px line instead of an ellipsis while the row has room', () => {
    const desc = ruleFor("[class*='_cardDesc']")
    // Three whole 18px lines: the clamp and the height cap agree, so no partial fourth line shows.
    expect(desc).toMatch(/max-height:\s*54px;/u)
    expect(desc).toMatch(/-webkit-line-clamp:\s*3;/u)
    expect(desc).not.toMatch(/line-clamp:\s*2;/u)
  })

  it('keeps the switch on the title line however many lines the summary takes', () => {
    const end = ruleFor("li[data-plugin-package] [class*='_cardHead']:has([class*='_cardDesc']:not(:empty)) > [class*='_cardEnd']")
    expect(end).toMatch(/align-self:\s*flex-start;/u)
  })
})

describe('core Plugins tiles are never solid (council round 11, D4)', () => {
  /** The custom properties one row's rules set, the later rule winning, as the cascade resolves equal specificity. */
  const propsOf = (needle: string): Record<string, string> =>
    Object.fromEntries(
      rules
        .filter(([selector]) => selector.split(',').some(part => part.trim().endsWith(needle)))
        .flatMap(([, body]) => [...body.matchAll(/(--dshx-plugin-(?:tone|glyph)):\s*([^;]+);/gu)].map(([, key = '', value = '']) => [key, value.trim()] as const)),
    )
  const glyphNamed = (value: string | undefined, path: string): boolean => (value ?? '').startsWith('url("data:image/svg+xml,') && (value ?? '').includes(path)

  it('still renders the hooks: built-in item ids, inline artwork, and package images', () => {
    expect(page.includes('ITEM_ARTWORK=new Map([[`shell`'), 'item artwork map').toBe(true)
    for (const id of ['agent-loop', 'subagent', 'web-search']) expect(page.includes(`[\`${id}\`,`), id).toBe(true)
    expect(/className:PluginManagerPage_module_css_default\.packageImage,src/u.test(page), 'package image').toBe(true)
  })

  it('redraws inline artwork (built-in items, the default art) as an 18px outline glyph in the tile tone', () => {
    const hide = rules.find(([selector]) => selector.includes(":has(> svg) > svg"))
    expect(hide?.[1]).toMatch(/display:\s*none;/u)
    const mark = rules.find(([selector]) => selector.includes(':has(> svg)::before'))?.[1] ?? ''
    expect(mark).toMatch(/flex:\s*0 0 18px;/u)
    expect(mark).toMatch(/height:\s*18px;/u)
    expect(mark).toMatch(/background-color:\s*var\(--dshx-plugin-tone\);/u)
    expect(mark).toMatch(/mask:\s*var\(--dshx-plugin-glyph\) center \/ 18px 18px no-repeat;/u)
    // Default glyph: lucide `puzzle` at the Settings column's 1.5 stroke.
    const frame = ruleFor('[data-plugin-panel][data-plugin-panel] {')
    expect(frame).toMatch(/--dshx-plugin-glyph:\s*url\("data:image\/svg\+xml,[^"]*stroke-width='1\.5'[^"]*M15\.39 4\.39/u)
  })

  it('draws named built-ins with their Settings column glyph and group tone: Subagents rose, Web search copper', () => {
    const subagent = propsOf("li[data-plugin-item='subagent']")
    expect(subagent['--dshx-plugin-tone']).toBe('var(--dshx-identity-4)')
    expect(glyphNamed(subagent['--dshx-plugin-glyph'], "M7 11v4a2 2 0 0 0 2 2h4"), 'workflow').toBe(true)
    const web = propsOf("li[data-plugin-item='web-search']")
    expect(web['--dshx-plugin-tone']).toBe('var(--dshx-identity-3)')
    expect(glyphNamed(web['--dshx-plugin-glyph'], 'M12 2a14.5 14.5 0 0 0 0 20'), 'globe').toBe(true)
    const loop = propsOf("li[data-plugin-item='agent-loop']")
    expect(loop['--dshx-plugin-tone']).toBe('var(--dshx-identity-4)')
    expect(glyphNamed(loop['--dshx-plugin-glyph'], 'm17 2 4 4-4 4'), 'repeat').toBe(true)
    expect(glyphNamed(propsOf("li[data-plugin-item='shell']")['--dshx-plugin-glyph'], 'm7 11 2-2-2-2'), 'square-terminal').toBe(true)
  })

  it('draws DSH packages whose artwork is a filled block as an outline glyph instead of a solid silhouette', () => {
    for (const [name, path] of [
      ['/dsh-experimental-auto-review', 'm9 12 2 2 4-4'],
      ['/dsh-experimental-forge-bundle', "M13 6h3a2 2 0 0 1 2 2v7"],
      ['/dsh-experimental-plugin-market-bundle', 'M10 22V7a1 1 0 0 0-1-1H4'],
    ] as const) {
      expect(glyphNamed(propsOf(`li[data-plugin-package$='${name}']`)['--dshx-plugin-glyph'], path), name).toBe(true)
      const hidden = rules.find(([selector, body]) => selector.includes(`[data-plugin-package$='${name}']`) && selector.includes("[class*='_cardIcon'] > *") && /display:\s*none;/u.test(body))
      expect(hidden, `${name} hides its image`).toBeDefined()
      const drawn = rules.find(([selector]) => selector.includes(`[data-plugin-package$='${name}']`) && selector.includes("[class*='_cardIcon']::before"))
      expect(drawn, `${name} draws the glyph`).toBeDefined()
    }
  })
})

describe('core Plugins header (council round 7, D1 and D5)', () => {
  it('still renders the toolbar, its Refresh button and the title hooks', () => {
    expect(page.includes('"data-plugin-toolbar"') || page.includes('data-plugin-toolbar'), 'toolbar').toBe(true)
    expect(new RegExp('"addButton":\\s*`[A-Za-z0-9]+_[A-Za-z0-9]+_addButton`', 'u').test(page), 'addButton').toBe(true)
    // The module draws both header buttons 32px tall; Refresh's outline is a 0.5px hairline drawn inside a 0.5px
    // transparent border, so it reads about 31px and fainter than the filled Add plugin beside it.
    expect(/_addButton,\.[A-Za-z0-9]+_[A-Za-z0-9]+_addPrimary,\.[A-Za-z0-9]+_[A-Za-z0-9]+_addMore\{[^}]*height:32px/u.test(page), 'module height').toBe(true)
  })

  it('draws Refresh with a full 1px edge at its 32px box, like the kit outline button beside Add plugin', () => {
    const refresh = ruleFor("[data-plugin-toolbar] [class*='_addButton'][aria-busy]")
    expect(refresh).toMatch(/height:\s*32px;/u)
    expect(refresh).toMatch(/border:\s*1px solid var\(--dsw-alias-border-l2\);/u)
    expect(refresh).toMatch(/box-shadow:\s*none;/u)
  })

  it('sets the labelled header buttons like kit buttons: label at 500, the kit 8px icon gap (council round 17, D3)', () => {
    // The Host Button draws a 4px gap at weight 400; Refresh and Add plugin carry a label, the chevron half does not.
    expect(new RegExp('"addPrimary":\\s*`[A-Za-z0-9]+_[A-Za-z0-9]+_addPrimary`', 'u').test(page), 'addPrimary').toBe(true)
    const label = rules.find(([selector]) => selector.includes("[data-plugin-toolbar] [class*='_addButton']") && !selector.includes('aria-busy'))
    expect(label?.[0]).toContain("[data-plugin-toolbar] [class*='_addPrimary']")
    expect(label?.[0]).not.toContain('_addMore')
    expect(label?.[1]).toMatch(/font-weight:\s*500;/u)
    expect(label?.[1]).toMatch(/gap:\s*8px;/u)
  })

  it('marks the page title with its own Settings leaf glyph, the teal package of the Plugins group, 18px, 8px before the h1 (round 8, D4)', () => {
    const title = ruleFor("[class*='_pageTitle']")
    expect(title).toMatch(/display:\s*flex;/u)
    expect(title).toMatch(/gap:\s*8px;/u)
    const mark = ruleFor("[class*='_pageTitle']::before")
    expect(mark).toMatch(/flex:\s*0 0 18px;/u)
    expect(mark).toMatch(/height:\s*28px;/u)
    expect(mark).toMatch(/background-color:\s*var\(--dshx-identity-1\);/u)
    // lucide `package`, the Plugins row's glyph in the Settings column, at the column's 1.5 stroke.
    expect(mark).toMatch(/mask:\s*url\("data:image\/svg\+xml,[^"]*stroke-width='1\.5'[^"]*M11 21\.73[^"]*"\)/u)
    expect(mark).not.toContain('M9.671 4.136')
    expect(mark).toMatch(/center \/ 18px 18px no-repeat;/u)
  })
})
