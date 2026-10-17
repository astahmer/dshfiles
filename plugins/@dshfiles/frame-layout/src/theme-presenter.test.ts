import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTENT_FONT_SIZE, readContentFontSize } from './native/client/theme-presenter.js'

describe('content font size decoding', () => {
  it('reads the per-role font map the current runtime sends', () => {
    expect(readContentFontSize({ fontSizes: { text: 16 } })).toBe(16)
  })

  it('falls back to the flat size a pre-0.2.1 runtime sends', () => {
    expect(readContentFontSize({ fontSize: 17 })).toBe(17)
  })

  it('prefers the per-role size when both shapes are present', () => {
    expect(readContentFontSize({ fontSizes: { text: 16 }, fontSize: 17 })).toBe(16)
  })

  it('keeps the runtime default when neither shape carries a size', () => {
    expect(readContentFontSize({ fontSizes: {} })).toBe(DEFAULT_CONTENT_FONT_SIZE)
    expect(readContentFontSize({})).toBe(DEFAULT_CONTENT_FONT_SIZE)
    expect(readContentFontSize(undefined)).toBe(DEFAULT_CONTENT_FONT_SIZE)
  })
})
