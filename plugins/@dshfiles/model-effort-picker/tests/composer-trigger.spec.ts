import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
const tagOf = (marker: string): string => {
  const at = picker.indexOf(marker)
  return picker.slice(picker.lastIndexOf('<', at), picker.indexOf('>\n', at))
}

describe('composer trigger on the phone (council picker N8)', () => {
  it('draws the off-default account tag in ink at 600, apart from the muted rest of the chip', () => {
    const tag = tagOf('data-model-picker-provider')
    expect(tag).toMatch(/dshx:font-semibold/u)
    expect(tag).toMatch(/dshx:text-foreground/u)
    expect(tag).not.toMatch(/text-muted-foreground/u)
  })

  it('moves the swap shortcut off the phone bar, where the details account rows do the same job at 44 px', () => {
    expect(tagOf('data-model-account-swap')).toMatch(/dshx:in-data-model-mark:hidden/u)
  })
})
