// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Collapsible, CollapsibleContent, CollapsibleTrigger, DisclosureTrigger } from '../src/components/ui/collapsible.js'

// Council round 5 A5: one disclosure. A 16px chevron that rotates, never the native ▶ marker.
afterEach(cleanup)

const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const disclosureCss = readFileSync(join(process.cwd(), 'src/disclosure.css'), 'utf8')
// An SVG's className is an SVGAnimatedString, so read the attribute.
const classes = (element: Element | null | undefined): readonly string[] => element?.getAttribute('class')?.split(/\s+/u) ?? []

describe('kit disclosure (council round 5 A5)', () => {
  it('draws a 16px chevron that turns a quarter when open, the label after it', () => {
    const view = render(
      <Collapsible>
        <DisclosureTrigger>Quota recovery</DisclosureTrigger>
        <CollapsibleContent>Body</CollapsibleContent>
      </Collapsible>,
    )
    const trigger = view.getByRole('button', { name: 'Quota recovery' })
    const chevron = trigger.querySelector('[data-slot="disclosure-chevron"]')
    expect(chevron).not.toBeNull()
    expect(chevron?.getAttribute('aria-hidden')).toBe('true')
    expect(classes(chevron)).toEqual(
      expect.arrayContaining(['dshx:size-4', 'dshx:text-muted-foreground', 'dshx:group-data-[state=open]/disclosure:rotate-90', 'dshx:motion-reduce:transition-none']),
    )
    expect(trigger.firstElementChild).toBe(chevron)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('data-state')).toBe('open')
    expect(classes(trigger)).toContain('dshx:group/disclosure')
  })

  it('keeps the plain CollapsibleTrigger for asChild callers', () => {
    const view = render(
      <Collapsible>
        <CollapsibleTrigger asChild>
          <button type="button">Mine</button>
        </CollapsibleTrigger>
      </Collapsible>,
    )
    expect(view.getByRole('button', { name: 'Mine' }).querySelector('[data-slot="disclosure-chevron"]')).toBeNull()
  })

  it('offers dshx:disclosure for a <details>: no native marker, the same chevron, rotated when open', () => {
    expect(styles).toContain("@import './disclosure.css';")
    expect(disclosureCss).toContain('@utility disclosure {')
    expect(disclosureCss).toMatch(/& > summary \{[^}]*list-style: none;/u)
    expect(disclosureCss).toMatch(/& > summary::-webkit-details-marker \{\s*display: none;/u)
    expect(disclosureCss).toMatch(/& > summary::marker \{\s*content: '';/u)
    expect(disclosureCss).toMatch(/& > summary::before \{[^}]*width: 16px;[^}]*height: 16px;[^}]*background-color: var\(--dsw-alias-label-secondary\);/u)
    expect(disclosureCss).toMatch(/&\[open\] > summary::before \{\s*rotate: 90deg;/u)
    expect(disclosureCss).toContain('prefers-reduced-motion: reduce')
  })
})
