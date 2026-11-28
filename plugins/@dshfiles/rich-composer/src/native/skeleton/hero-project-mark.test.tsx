// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { HeroShell } from './EmptyHero.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => {
  document.body.innerHTML = ''
})

const english: Record<string, string> = { 'hero.headline': 'What should we build?', 'hero.headlineProject': 'What should we build in {project}?' }
const t = ((key: string, params?: { readonly project?: string }) => (english[key] ?? key).replace('{project}', params?.project ?? '')) as Parameters<typeof HeroShell>[0]['t']
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'HeroShell.module.css'), 'utf8')

// Unslop round five C5 (council round 4): the new-thread headline names the project in words only; the thread list,
// tabs and the run row all show its mark, so the headline gets the same identity tile.
describe('the new-thread headline', () => {
  it("draws the project's mark beside its name, and keeps the sentence's text as written", async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => createRoot(host).render(<HeroShell t={t} project="billing-api" />))
    const headline = host.querySelector('[data-hero-headline]')
    // The mark's letters are drawn by CSS, so reading, copying and finding the sentence never meets "BAbilling-api".
    expect(headline?.textContent).toBe('What should we build in billing-api?')
    const mark = headline?.querySelector('[data-hero-project] [data-slot="project-mark"]')
    expect(mark?.getAttribute('data-letters')).toBe('BA')
    expect(mark?.className).toMatch(/project-tone-balanced-\d/u)
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
  })

  it('names no mark before a project is chosen', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => createRoot(host).render(<HeroShell t={t} />))
    expect(host.querySelector('[data-slot="project-mark"]')).toBeNull()
    expect(host.querySelector('[data-hero-headline]')?.textContent).toBe('What should we build?')
  })

  it("sizes the mark with the headline and draws its letters from the attribute", () => {
    expect(css).toMatch(/\.projectMark::after \{\s*content: attr\(data-letters\);/)
    // Sized in the mark's own em (half the headline's): a 26px headline draws a 29px tile.
    expect(css).toMatch(/\.projectMark \{[^}]*height: 2\.2em;[^}]*font-size: 0\.5em;/)
    // The kit mark's AA pull toward the ink.
    expect(css).toMatch(/color: color-mix\(in oklab, currentColor 75%, var\(--dsw-alias-label-primary\)\)/)
    // Council round 34 A1: the kit mark's 18% tile (`bg-current/18`), so the headline and the project picker draw one mark.
    expect(css).toMatch(/background: color-mix\(in oklab, currentColor 18%, transparent\);/)
  })
})
