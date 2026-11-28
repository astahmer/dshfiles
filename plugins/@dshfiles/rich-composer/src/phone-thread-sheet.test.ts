import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '')
const css = strip(readFileSync(resolve(here, 'native/skeleton/ConversationRoot.module.css'), 'utf8'))
const kit = strip(readFileSync(resolve(here, '../../plugin-ui/src/styles.css'), 'utf8'))

/** Bodies of every rule whose selector is exactly `selector`, at any depth. */
const rule = (sheet: string, selector: string): string =>
  [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => (match[1] ?? '').trim() === selector)
    .map(match => match[2] ?? '')
    .join('\n')

const declaration = (body: string, property: string): string | undefined =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g'))].at(-1)?.[1]?.replace(/\s*!important$/u, '').trim()

// Council round 35 P2 (Opus, Fable): the phone thread ⋯ sheet read as a grey panel beside the row menu's sheet, with bare
// labels. It is the kit sheet's surface now, named by its thread, with rows like the row menu's: 44px, a 20px icon in the
// ink, a tertiary detail and a chevron on a row that opens something.
describe('the phone thread ⋯ sheet (council round 35 P2)', () => {
  it('takes the kit sheet\'s own surface, edge and scrim, so it and the row menu\'s sheet match exactly', () => {
    const kitSheet = [...kit.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(
      match => (match[1] ?? '').includes("[data-slot='context-menu-content']") && /background: var\(--dsw-alias-bg-layer-2\) !important/u.test(match[2] ?? ''),
    )?.[2]
    expect(kitSheet).toBeDefined()
    const sheet = rule(css, '.phoneSheet')
    expect(declaration(sheet, 'background')).toBe(declaration(kitSheet ?? '', 'background'))
    expect(declaration(sheet, 'background')).not.toMatch(/tone-raised/u)
    expect(declaration(sheet, 'border-top')).toBe('1px solid var(--dsw-alias-border-l2)')
    // The kit sheet's insets: 8px at the sides, so a row's text starts 16px in, as the row menu's does.
    expect(declaration(sheet, 'padding')).toBe('8px 8px calc(8px + env(safe-area-inset-bottom, 0px))')
    // One scrim colour with the kit's, and none of its own while a kit sheet (a nested menu) dims the page over it.
    expect(declaration(rule(css, '.phoneScrim'), 'background')).toBe('var(--dshx-scrim)')
    expect(kit).toMatch(/var\(--dshx-scrim[,)]/u)
    expect(css).toMatch(/:global\(body:has\(\[data-slot='dropdown-menu-content'\][^)]*\)\) \.phoneScrim \{\s*background: transparent;/u)
  })

  it('heads the sheet with the thread title at 14px semibold, at most two lines (the row menu\'s B9 title)', () => {
    const title = rule(css, '.phoneSheetTitle')
    expect(declaration(title, 'font-size')).toBe('14px')
    expect(declaration(title, 'font-weight')).toBe('600')
    expect(declaration(title, '-webkit-line-clamp')).toBe('2')
    expect(declaration(title, 'padding')).toBe('4px 8px 8px')
  })

  it('draws 44px rows: a 20px icon in the ink, the label, a right-aligned tertiary detail, a chevron', () => {
    const row = rule(css, '.phoneSheetTool')
    expect(declaration(row, 'min-height')).toBe('44px')
    expect(declaration(row, 'display')).toBe('flex')
    expect(declaration(row, 'padding')).toBe('0 8px')
    const icon = rule(css, '.phoneSheetToolIcon')
    expect(declaration(icon, 'width')).toBe('20px')
    expect(declaration(icon, 'height')).toBe('20px')
    expect(declaration(icon, 'color')).toBe('var(--dsw-alias-label-primary)')
    expect(declaration(rule(css, '.phoneSheetToolIcon > :global(svg)'), 'width')).toBe('20px')
    const detail = rule(css, '.phoneSheetToolDetail')
    expect(declaration(detail, 'margin-left')).toBe('auto')
    expect(declaration(detail, 'color')).toBe('var(--dsw-alias-label-tertiary)')
    expect(declaration(rule(css, '.phoneSheetToolChevron'), 'color')).toBe('var(--dsw-alias-label-tertiary)')
    // The label takes the room between them and truncates; the chevron ends the row even with no detail.
    expect(declaration(rule(css, '.phoneSheetToolLabel'), 'text-overflow')).toBe('ellipsis')
    expect(declaration(rule(css, '.phoneSheetToolDetail + .phoneSheetToolChevron'), 'margin-left')).toBe('0')
  })

  it('lays the thread\'s place out as a row like the tools: "In the project" with its icon, a chevron at the end', () => {
    const place = rule(css, ".phoneSheetRows :global([data-workspace-place])")
    expect(declaration(place, 'width')).toBe('100%')
    // The chip's own 240px cap would stop the row short of the sheet's edge.
    expect(declaration(place, 'max-width')).toBe('none')
    expect(declaration(place, 'min-height')).toBe('44px')
    expect(declaration(place, 'justify-content')).toBe('flex-start')
    expect(declaration(place, 'background')).toBe('transparent')
    expect(declaration(place, 'border')).toBe('0')
    expect(declaration(rule(css, ".phoneSheetRows :global([data-workspace-place]) > :global(svg:first-child)"), 'width')).toBe('20px')
    const chevron = rule(css, ".phoneSheetRows :global([data-workspace-place]) > :global(svg:last-child)")
    expect(declaration(chevron, 'margin-left')).toBe('auto')
    expect(declaration(chevron, 'rotate')).toBe('-90deg')
  })
})
