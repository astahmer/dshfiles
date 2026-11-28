import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
const details = readFileSync(new URL('../src/model-details.tsx', import.meta.url), 'utf8')

describe('Close ends the Tab cycle (council picker round 3, R17)', () => {
  it('draws one Close for the picker, after the list and the details in the DOM', () => {
    expect(details).not.toContain('Close model picker')
    expect(picker.match(/aria-label="Close model picker"/gu) ?? []).toHaveLength(1)
    const close = picker.indexOf('data-model-picker-close')
    expect(close).toBeGreaterThan(picker.indexOf('data-model-inspector'))
    expect(close).toBeGreaterThan(picker.lastIndexOf('<FanOutSelection'))
    // Nothing focusable follows it inside the popover.
    const after = picker.slice(close, picker.indexOf('</PopoverContent>'))
    expect(after.match(/<button|<Button|<input|<SearchInput/gu) ?? []).toHaveLength(0)
  })

  it('keeps its place at the top right, with room kept for it in the headers', () => {
    const tag = picker.slice(
      picker.lastIndexOf('<button', picker.indexOf('data-model-picker-close')),
      picker.indexOf('>', picker.indexOf('data-model-picker-close')),
    )
    expect(tag).toMatch(/catalogEmpty \? 'dshx:top-3 dshx:pointer-coarse:top-0' : 'dshx:top-2\.5 dshx:@max-pane-compact:top-0',\s*'dshx:absolute dshx:right-2\.5/u)
    expect(details).toMatch(/data-model-details-header|dshx:pr-7 dshx:pointer-coarse:pr-12/u)
    expect(details).toMatch(/dshx:pr-7 [^"]*dshx:pointer-coarse:pr-12/u)
  })
})
