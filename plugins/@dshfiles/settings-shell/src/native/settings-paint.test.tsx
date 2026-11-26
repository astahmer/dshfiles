import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSection } from './general-section.js'
import { LanguageCoverageNote } from './language-note.js'
import { shellMessages, type ShellTranslate } from './locales.js'

const t: ShellTranslate = key => key

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

describe('Settings › General paints once (round three item 30)', () => {
  it('puts a late release notice after the rows, so its arrival moves none of them', async () => {
    await act(async () =>
      root.render(
        <GeneralSection
          banner={<div data-testid="release-notice" />}
          renderSlot={() => (
            <div data-testid="rows">
              <div>Permission</div>
              <div>Language</div>
            </div>
          )}
        />,
      ),
    )
    const rows = container.querySelector('[data-testid="rows"]')
    const notice = container.querySelector('[data-testid="release-notice"]')
    if (rows === null || notice === null) throw new Error('rows or notice missing')
    expect(rows.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/** The SVG document a card's preview variable carries. */
const previewSvg = (value: string | undefined): string => decodeURIComponent(/^url\("data:image\/svg\+xml,(.*)"\)$/u.exec(value ?? '')?.[1] ?? '')

describe('Settings › General below 28rem and its Appearance cards (round five B7)', () => {
  it('stacks every native row and gives each theme card an 80×46 preview drawn in that theme (council round 10 B3)', async () => {
    await act(async () => root.render(<GeneralSection renderSlot={() => null} />))
    const column = container.querySelector<HTMLElement>('[data-settings-theme-swatches]')
    expect(column?.className).toContain('dshx:@max-pane-narrow:[&_[class$=row]]:flex-col!')
    expect(column?.className).not.toContain('flex-wrap')
    for (const scheme of ['light', 'dark', 'system']) {
      const svg = previewSvg(column?.style.getPropertyValue(`--settings-swatch-${scheme}`))
      // The theme's page, its sidebar strip, two text lines and one indigo diamond.
      expect(svg).toContain('viewBox="0 0 96 56"')
      // Drawn on the 96×56 grid, shown at 80×46 so the card stays 88–96px tall.
      expect(svg).toContain('width="80" height="46"')
      expect(svg).toContain('data-part="sidebar"')
      expect(svg.match(/data-part="line"/gu)?.length).toBeGreaterThanOrEqual(2)
      expect(svg).toContain('<polygon data-part="diamond"')
    }
    // The card's icon gives way to the preview, which is 80×46 and leads the card; 8px padding: 2 + 16 + 46 + 8 + 22.
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]>svg]:hidden!')
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]]:before:h-[46px]')
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]]:before:w-20')
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]]:py-2!')
    expect(column?.className).not.toContain('dshx:[&_[class*=_themeCube]]:py-3!')
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]]:before:order-first')
    // The light card's paper differs from the dark card's: each swatch shows its own theme.
    expect(column?.style.getPropertyValue('--settings-swatch-light')).not.toBe(column?.style.getPropertyValue('--settings-swatch-dark'))
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube]:nth-child(2)]:before:[background:var(--settings-swatch-dark)]')
    // The chosen card is a selected card (council round 3 B3, A1): wash, ring edge and check, no inset row marker.
    expect(column?.className).toContain('dshx:[&_[class*=_themeCube][aria-pressed=true]]:selected-card!')
    expect(column?.className).not.toContain('selected-marker')
  })
})

describe('the Language note', () => {
  it('says what a language other than English and 中文 covers', async () => {
    await act(async () => root.render(<LanguageCoverageNote locale="fr" t={t} />))
    expect(container.querySelector('[data-settings-language-note]')?.textContent).toBe('general.languageNote')
    expect(shellMessages.en['general.languageNote']).toBe("dshfiles plugins are written in English. Other languages translate DSH's built-in parts only.")
  })

  it('says nothing in English or 中文, which every plugin carries', async () => {
    for (const locale of ['en', 'en-GB', 'zh', 'zh-CN']) {
      await act(async () => root.render(<LanguageCoverageNote locale={locale} t={t} />))
      expect(container.querySelector('[data-settings-language-note]')).toBeNull()
    }
  })
})
