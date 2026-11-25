import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GENERAL_HEADINGS, GeneralGroupHeading, GeneralSection } from './general-section.js'
import { shellMessages } from './locales.js'

// The package root is vitest's working directory.
const client = (): string => readFileSync('src/client.tsx', 'utf8')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

/** The General rows' slot orders in this composition: core's Permission -20, Language 0, Appearance 10 and Font size 11, chat's transcript rows 12. */
const PERMISSION = -20
const FONT_SIZE = 11
const TRANSCRIPT_ROWS = 12
const SHOW_CODING_VIEW = 15

describe('Settings › General groups its transcript rows (council round 6 B5)', () => {
  it('puts a 15/20 "Transcript" heading right before View mode, collapse and replies, and closes the group after them', () => {
    const transcript = GENERAL_HEADINGS.find(heading => heading.key === 'general.transcriptHeading')
    const behavior = GENERAL_HEADINGS.find(heading => heading.key === 'general.behaviorHeading')
    expect(transcript?.order).toBeGreaterThan(FONT_SIZE)
    expect(transcript?.order).toBeLessThan(TRANSCRIPT_ROWS)
    expect(behavior?.order).toBeGreaterThan(TRANSCRIPT_ROWS)
    expect(behavior?.order).toBeLessThan(SHOW_CODING_VIEW)
    expect(shellMessages.en['general.transcriptHeading']).toBe('Transcript')
    expect(shellMessages.en['general.behaviorHeading']).toBe('Behavior')
    expect(shellMessages.zh['general.transcriptHeading']).not.toBe('')
    // Each heading is registered as a General row of its own.
    expect(client()).toMatch(/for \(const heading of GENERAL_HEADINGS\)/u)
  })

  it('opens General with a "Basics" heading above Permission, Language, Appearance and Font size (council round 7 B2)', async () => {
    const basics = GENERAL_HEADINGS.find(heading => heading.key === 'general.basicsHeading')
    expect(basics?.order).toBeLessThan(PERMISSION)
    expect(shellMessages.en['general.basicsHeading']).toBe('Basics')
    expect(shellMessages.zh['general.basicsHeading']).not.toBe('')
    // The first heading on the page starts at the top: no 24px gap above it.
    await act(async () => root.render(<GeneralGroupHeading first label="Basics" />))
    const heading = container.querySelector('h3')
    expect(heading?.className).toContain('dshx:text-heading')
    expect(heading?.className).not.toContain('dshx:pt-6')
    expect(GENERAL_HEADINGS.filter(heading => 'first' in heading && heading.first === true).map(heading => heading.key)).toEqual(['general.basicsHeading'])
  })

  it('draws the heading at the contextual heading size, set apart from the row above it', async () => {
    await act(async () => root.render(<GeneralGroupHeading label="Transcript" />))
    const heading = container.querySelector('h3')
    expect(heading?.textContent).toBe('Transcript')
    expect(heading?.className).toContain('dshx:text-heading')
    expect(heading?.className).toContain('dshx:pt-6')
    expect(heading?.hasAttribute('data-settings-general-heading')).toBe(true)
  })

  it('caps every row\'s helper copy at 60ch', async () => {
    await act(async () => root.render(<GeneralSection renderSlot={() => null} />))
    const column = container.querySelector<HTMLElement>('[data-settings-theme-swatches]')
    expect(column?.className).toContain('dshx:[&_[class*=_desc]]:max-w-[60ch]!')
    expect(column?.className).toContain('dshx:[&_[class*=Description]]:max-w-[60ch]!')
  })
})
