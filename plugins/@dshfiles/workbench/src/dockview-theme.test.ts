// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./dockview-theme.css', import.meta.url), 'utf8')

describe('the tab chrome (round five T5)', () => {
  it('sets inactive tabs on the panel step and hovered ones on the raised step, the selected tab on bg', () => {
    expect(css).toMatch(/--dsh-main-tab-bg: var\(--dshx-tone-panel, /u)
    expect(css).toMatch(/--dsh-main-tab-bg-hover: var\(--dshx-tone-raised, /u)
    expect(css).toMatch(/--dv-activegroup-visiblepanel-tab-background-color: var\(--dshx-tone-bg, /u)
  })

  it('leaves the horizontal inset to the tab content, so every tab starts 12px in', () => {
    expect(css).toMatch(/\.dshfiles-workbench-theme \.dv-tabs-container > \.dv-tab \{\s*padding-inline: 0;/u)
  })
})
