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
