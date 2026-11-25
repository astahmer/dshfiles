import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/native/client/AppFrame.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const NAV = 'background: var(--dshx-surface-nav, var(--dshx-tone-panel, var(--dsw-alias-bg-base)));'

describe('the status strip surface (council round 6, A4 follow-up)', () => {
  it('fills the desktop strip with the nav surface it continues, lifted in dark', () => {
    const strip = /\n\.statusStrip \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(strip).toContain(NAV)
  })

  it('fills the phone status chip with the nav surface too', () => {
    const chip = /:global\(\[data-shell-phone-nav\]\) \.statusChip \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(chip).toContain(NAV)
  })
})
