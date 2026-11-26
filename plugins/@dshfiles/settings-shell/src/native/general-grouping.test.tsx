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
    // The first heading on the page starts at the top: no 32px gap above it.
    await act(async () => root.render(<GeneralGroupHeading first label="Basics" />))
    const heading = container.querySelector('h3')
    expect(heading?.className).toContain('dshx:settings-heading')
    expect(heading?.className).toContain('dshx:mt-0!')
    expect(GENERAL_HEADINGS.filter(heading => 'first' in heading && heading.first === true).map(heading => heading.key)).toEqual(['general.basicsHeading'])
  })

  it('draws the heading at the Settings heading step, 15/20 at 600 with 32px above (council round 8 B4)', async () => {
    await act(async () => root.render(<GeneralGroupHeading label="Transcript" />))
    const heading = container.querySelector('h3')
    expect(heading?.textContent).toBe('Transcript')
    expect(heading?.className).toContain('dshx:settings-heading')
    expect(heading?.className).not.toContain('dshx:pt-6')
    expect(heading?.className).not.toContain('dshx:mt-0!')
    expect(heading?.hasAttribute('data-settings-general-heading')).toBe(true)
  })

  it('puts every native row on the kit Settings row grammar, the last row and the captioned Language row without a hairline (council round 8 B4)', async () => {
    await act(async () => root.render(<GeneralSection renderSlot={() => null} />))
    const column = container.querySelector<HTMLElement>('[data-settings-theme-swatches]')?.className ?? ''
    expect(column).toContain('dshx:[&_[class$=row]]:settings-row!')
    expect(column).toContain("dshx:[&>[data-slot='settings.general.item']>:last-child]:bg-none!")
    expect(column).toContain('dshx:[&_[class$=row]:has(+[data-settings-language-note])]:bg-none!')
    expect(column).toContain('dshx:[&_[class$=row]_[class*=_title_]]:settings-label!')
    expect(column).toContain('dshx:[&_[class$=row]_[class*=_description_]]:settings-description!')
    // The theme row is core's `_group` with a `_title` (no trailing `_`) over its cubes: it read 14/400 beside the
    // 14/500 labels (round nine B1).
    expect(column).toContain('dshx:[&_[class$=_title]:has(+[class$=_cubeRow])]:settings-label!')
  })

  it('draws the chosen theme card as the kit selected card on the card surface: core\'s platform fill is dropped (council round 8 B4, A2)', async () => {
    await act(async () => root.render(<GeneralSection renderSlot={() => null} />))
    const column = container.querySelector<HTMLElement>('[data-settings-theme-swatches]')?.className ?? ''
    expect(column).toContain('dshx:[&_[class*=_themeCube][aria-pressed=true]]:selected-card!')
    expect(column).toContain('dshx:[&_[class*=_themeCube][aria-pressed=true]]:bg-transparent!')
  })

  it('caps every row\'s helper copy at 60ch', async () => {
    await act(async () => root.render(<GeneralSection renderSlot={() => null} />))
    const column = container.querySelector<HTMLElement>('[data-settings-theme-swatches]')
    expect(column?.className).toContain('dshx:[&_[class*=_desc]]:max-w-[60ch]!')
    expect(column?.className).toContain('dshx:[&_[class*=Description]]:max-w-[60ch]!')
  })
})
