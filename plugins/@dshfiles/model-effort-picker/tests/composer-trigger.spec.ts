import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
const tagOf = (marker: string): string => {
  const at = picker.indexOf(marker)
  return picker.slice(picker.lastIndexOf('<', at), picker.indexOf('>\n', at))
}

describe('composer trigger on the phone (council picker N8)', () => {
  it('draws the default account tag muted at 500 and another account in ink at 600 after its 6 px dot (round 3 R8)', () => {
    const tag = picker.slice(picker.indexOf('data-model-picker-provider'), picker.indexOf('</Tooltip>', picker.indexOf('data-model-picker-provider')))
    expect(tag).toContain("shortLabel.offDefault === true ? 'dshx:font-semibold dshx:text-foreground' : 'dshx:font-medium dshx:text-muted-foreground'")
    expect(tag).toMatch(/shortLabel\.offDefault === true \? \(\s*<i[^>]*dshx:size-1\.5[^>]*data-model-picker-account-dot/u)
  })

  it('moves the swap shortcut off the phone bar, where the details account rows do the same job at 44 px', () => {
    expect(tagOf('data-model-account-swap')).toMatch(/dshx:in-data-model-mark:hidden/u)
  })
})
