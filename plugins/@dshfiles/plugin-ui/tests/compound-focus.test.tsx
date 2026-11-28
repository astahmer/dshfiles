// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../src/components/ui/input-group.js'

afterEach(cleanup)

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
/** The declarations of the unlayered rule whose selector list is exactly `selector`. */
const rule = (selector: string): string => {
  const at = styles.indexOf(`${selector} {`)
  return at < 0 ? '' : styles.slice(at + selector.length + 2, styles.indexOf('}', at))
}

const WRAPPER = ":where([data-slot='input-group']):has(:is(input, textarea)[data-slot]:focus-visible:not([aria-invalid='true']))"
const COMMAND = ":where([data-slot='command-input-wrapper']):has(input[data-slot]:focus-visible)"
const FIELD = ":where([data-slot='input-group'], [data-slot='command-input-wrapper']) :is(input, textarea)[data-slot]:focus-visible:not([aria-invalid='true'])"
const GLOBAL_RING = ":focus-visible:not([aria-invalid='true']):not([role^='menuitem'], [role='option'], [data-slot$='-content']) {"

describe('one focus ring on compound fields (round five K7)', () => {
  it('draws the ring on the input group wrapper, 1px outside, while its field has focus', () => {
    expect(rule(WRAPPER)).toContain('outline: 2px solid var(--dsw-alias-state-business-primary);')
    expect(rule(WRAPPER)).toContain('outline-offset: 1px;')
  })

  it('draws the command input ring 2px inside, so a clipping palette never cuts it', () => {
    expect(rule(COMMAND)).toContain('outline: 2px solid var(--dsw-alias-state-business-primary);')
    expect(rule(COMMAND)).toContain('outline-offset: -2px;')
  })

  it('clears the field ring after the global ring rule, at a higher specificity', () => {
    expect(rule(FIELD)).toContain('outline: none;')
    expect(styles.indexOf(`${FIELD} {`)).toBeGreaterThan(styles.indexOf(GLOBAL_RING))
  })

  it('keeps the input group free of its own halo and border swap', () => {
    const view = render(
      <InputGroup>
        <InputGroupAddon>@</InputGroupAddon>
        <InputGroupInput aria-label="Search" />
      </InputGroup>,
    )
    const group = view.container.querySelector('[data-slot="input-group"]')!.getAttribute('class') ?? ''
    expect(group).not.toMatch(/focus-visible\]:(?:ring|border-ring)/)
    expect(group).toContain('dshx:has-[[data-slot][aria-invalid=true]]:border-destructive')
  })
})
