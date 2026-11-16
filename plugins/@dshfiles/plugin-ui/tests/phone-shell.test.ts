import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHONE_SHELL_QUERY, matchesPhoneShell } from '../src/lib/phone-shell.ts'

// Vitest runs each package from its root.
const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8')

interface Device {
  readonly width: number
  readonly height: number
  readonly coarse: boolean
}

/** Evaluates the media features this rule uses, as a browser would for `device`. */
const evaluate = (query: string, device: Device): boolean =>
  query.split(',').some(part =>
    [...part.matchAll(/\(([a-z-]+):\s*([^)]+)\)/gu)].every(([, feature, value]) => {
      if (feature === 'pointer') return (value === 'coarse') === device.coarse
      if (feature === 'max-width') return device.width <= Number.parseFloat(value ?? '')
      if (feature === 'max-height') return device.height <= Number.parseFloat(value ?? '')
      throw new Error(`unexpected media feature ${String(feature)}`)
    }),
  )

const view = (device: Device): Pick<Window, 'matchMedia'> => ({
  matchMedia: (query: string) => ({ matches: evaluate(query, device) }) as MediaQueryList,
})

describe('phone shell media rule (unslop U8)', () => {
  it('keys the phone on width in portrait and on a short coarse side in landscape, never on a desktop or tablet', () => {
    expect(matchesPhoneShell(view({ width: 390, height: 844, coarse: true }))).toBe(true)
    expect(matchesPhoneShell(view({ width: 844, height: 390, coarse: true }))).toBe(true)
    expect(matchesPhoneShell(view({ width: 600, height: 900, coarse: false }))).toBe(true)
    expect(matchesPhoneShell(view({ width: 1440, height: 900, coarse: false }))).toBe(false)
    expect(matchesPhoneShell(view({ width: 1180, height: 820, coarse: true }))).toBe(false)
    expect(matchesPhoneShell(view({ width: 1440, height: 450, coarse: false }))).toBe(false)
  })

  it('offers it as the `phone` variant for viewport-level overlays', () => {
    const styles = read('src/styles.css')
    expect(styles).toMatch(/@custom-variant phone \{\s*@media \(max-width: 639\.98px\), \(pointer: coarse\) and \(max-height: 500px\) \{\s*@slot;/u)
  })

  it('is the rule every kit sheet and phone media block uses', () => {
    const styles = read('src/styles.css')
    const blocks = [...styles.matchAll(/@media ([^{]*639\.98px[^{]*)\{/gu)].map(match => (match[1] ?? '').trim())
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) expect(block).toContain('(pointer: coarse) and (max-height: 500px)')
    expect(styles).toContain('@media (pointer: coarse) and (max-width: 28rem), (pointer: coarse) and (max-height: 500px)')
    expect(read('src/hooks/sheet-drag.ts')).toContain('const PHONE_QUERY = PHONE_SHELL_QUERY')
    expect(PHONE_SHELL_QUERY).toBe('(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)')
  })

  it('draws a kit Command inside a phone sheet as the sheet list, not an inset card (unslop phone 33)', () => {
    const styles = read('src/styles.css')
    const rule = /\[data-slot='popover-content'\]\s*\)\s*\[data-slot='command'\] \{([^}]*)\}/u.exec(styles)
    expect(rule?.[1]).toContain('background: transparent')
    expect(rule?.[1]).toContain('border-radius: 0')
  })
})
