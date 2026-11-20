import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/** Selector lists of the rules that set `display: none`. */
const hidingSelectors = (): string[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter(match => /display:\s*none/u.test(match[2] ?? ''))
    .flatMap(match => (match[1] ?? '').split(',').map(part => part.replace(/\s+/gu, ' ').trim()))

describe('the phone status list (unslop phone 21)', () => {
  it('drops a row whose item says nothing, also when the item is wrapped in its open button', () => {
    const hidden = hidingSelectors()
    // An item that renders null leaves an empty .statusItem…
    expect(hidden).toContain('.statusSheetRow:has(.statusItem:empty)')
    // …and one that declares `open`, or draws its own control, leaves one empty button inside it ("Working", "Orphans", "Restart" with no value).
    expect(hidden).toContain('.statusSheetRow:has(.statusItem > button:only-child:empty)')
  })
})
