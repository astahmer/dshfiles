import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { PhoneStatusModel, PhoneStatusStore } from './phone-status.ts'
import type { StatusItem } from './status-strip.ts'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/client/AppFrame.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const strip = readFileSync(resolve(here, 'native/client/StatusStrip.tsx'), 'utf8')
const contract = readFileSync(resolve(here, 'status-strip.ts'), 'utf8')
const entry = readFileSync(resolve(here, 'client-entry.tsx'), 'utf8')

const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'
const phoneBlock = css.slice(css.lastIndexOf(PHONE))
const item: StatusItem = { id: 'x', side: 'global', label: 'X', component: () => null }

describe('phone status in the top bar, not a band above the tab bar (round five C2)', () => {
  it('draws the bottom pill row only while an item needs the user', () => {
    expect(PhoneStatusModel.stripMode(false)).toBe('button')
    expect(PhoneStatusModel.stripMode(true)).toBe('compact')
    const rule = phoneBlock.slice(phoneBlock.indexOf(":global([data-shell-phone-nav]) .statusStrip[data-status-strip='button'] {"))
    expect(rule.startsWith(":global([data-shell-phone-nav]) .statusStrip[data-status-strip='button'] {")).toBe(true)
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/display:\s*none/u)
    expect(strip).toMatch(/data-status-strip=\{PhoneStatusModel\.stripMode\(actionable\)\}/u)
  })

  it('reads an actionable state from the item content it measured', () => {
    const root = document.createElement('div')
    root.innerHTML = '<span><b>CC1 62%</b></span>'
    expect(PhoneStatusModel.actionable(root)).toBe(false)
    root.innerHTML = '<span><b data-status-actionable="">CC1 4% left</b></span>'
    expect(PhoneStatusModel.actionable(root)).toBe(true)
  })

  it('shows the button only at phone width with a visible item, named by what the items say', () => {
    // SAFETY: shown() only checks that a session store is present; it never calls it.
    const useSessions = (() => null) as never
    expect(PhoneStatusModel.shown({ narrow: true, summary: '', actionable: false, items: [], useSessions })).toBe(false)
    expect(PhoneStatusModel.shown({ narrow: false, summary: '', actionable: false, items: [item], useSessions })).toBe(false)
    expect(PhoneStatusModel.shown({ narrow: true, summary: '', actionable: false, items: [item], useSessions })).toBe(true)
    expect(PhoneStatusModel.label('')).toBe('Status')
    expect(PhoneStatusModel.label('2 working · CC1 62%')).toBe('Status: 2 working · CC1 62%')
  })

  it('notifies the button only when what it shows changes', () => {
    const store = new PhoneStatusStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.publish({ narrow: true, summary: '2 working' })
    store.publish({ narrow: true, summary: '2 working' })
    expect(listener).toHaveBeenCalledTimes(1)
    store.reset()
    expect(store.get().summary).toBe('')
  })

  it('publishes the button through a contract on the status-strip module, which the frame provides', () => {
    expect(contract).toMatch(/export const PhoneStatus = defineContract<PhoneStatusService>\('@dshfiles\/frame-layout\.phone-status'/u)
    expect(entry).toMatch(/plugin\.provide\(PhoneStatus, \{ Button: PhoneStatusButton \}\)/u)
  })
})
