// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./dockview-theme.css', import.meta.url), 'utf8')

describe('the tab chrome (round five T5, council round 6 B6)', () => {
  it('sets the strip on the nav surface with transparent inactive tabs, only the selected tab on the canvas', () => {
    expect(css).toMatch(/--dv-tabs-and-actions-container-background-color: var\(--dshx-surface-nav, /u)
    expect(css).toMatch(/--dsh-main-tab-bg: transparent;/u)
    expect(css).toMatch(/--dsh-main-tab-bg-hover: var\(--dshx-tone-raised, /u)
    expect(css).toMatch(/--dv-activegroup-visiblepanel-tab-background-color: var\(--dshx-tone-bg, /u)
  })

  it('marks the selected tab in ink, never the attention indigo (council round 6: indigo means attention only)', () => {
    const marker = /\.dv-active-group > \.dv-tabs-and-actions-container \.dv-tabs-container > \.dv-tab\.dv-active-tab::before \{\s*background-color: ([^;]+);/u.exec(css)
    expect(marker?.[1]).toBe('var(--dsw-alias-label-primary)')
    expect(css).not.toMatch(/dv-active-tab::before \{[^}]*tone-accent/u)
  })

  it('leaves the horizontal inset to the tab content, so every tab starts 12px in', () => {
    expect(css).toMatch(/\.dshfiles-workbench-theme \.dv-tabs-container > \.dv-tab \{\s*padding-inline: 0;/u)
  })
})

describe('a tab close on a coarse pointer (merge 534773f0)', () => {
  // The 20px close drew a 44px ::after hit area, but the next tab and dockview's horizontal scrollbar overlay sat above
  // it, and the strip's clip cut the last tab's area at its end: a tap 20px right of or below the glyph missed it.
  const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? ''
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    return new RegExp(`${escaped} \\{([^}]*)\\}`, 'u').exec(coarse)?.[1] ?? ''
  }

  it('keeps the 44px hit area round the 20px glyph', () => {
    expect(rule('.dshfiles-workbench-theme [data-workbench-tab-close]::after')).toMatch(/inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\);/u)
  })

  it('raises the close over the next tab and the strip scrollbar', () => {
    const close = rule('.dshfiles-workbench-theme [data-workbench-tab-close]')
    expect(close).toMatch(/position: relative;/u)
    expect(close).toMatch(/z-index: 1;/u)
  })

  it('ends each tab 12px after its close, so the strip never clips the hit area', () => {
    expect(rule('.dshfiles-workbench-theme [data-workbench-tab-id]')).toMatch(/padding-inline-end: 12px;/u)
  })
})
