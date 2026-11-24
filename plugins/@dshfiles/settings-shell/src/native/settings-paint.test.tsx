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
