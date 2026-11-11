import { expect, it } from 'vitest'
import { NativeToolView } from './native-tool-view.js'

const card = () => null
const native = () => null
const other = () => null
const REGISTRANT = '@dshfiles/tool-meta'

const entries = [
  { options: { key: 'read', priority: -10, registrant: REGISTRANT }, component: card },
  { options: { key: 'read', priority: 0, registrant: 'native' }, component: native },
  { options: { key: 'edit', priority: 0, registrant: 'native' }, component: other },
]

it('falls back to the native entry, never to the card that wins the slot (which would render itself forever)', () => {
  // The card wins by priority: a plain lowest-priority pick returns the card itself.
  expect(entries.filter(entry => entry.options.key === 'read').toSorted((l, r) => l.options.priority - r.options.priority)[0]?.component).toBe(card)
  expect(NativeToolView.pick({ entries, toolName: 'read', registrant: REGISTRANT, own: new Set([card]) })?.component).toBe(native)
})

it('skips an own card registered without a registrant name', () => {
  const unnamed = [{ options: { key: 'read', priority: -10 }, component: card }, entries[1]!]
  expect(NativeToolView.pick({ entries: unnamed, toolName: 'read', registrant: REGISTRANT, own: new Set([card]) })?.component).toBe(native)
})

it('returns undefined when only this plugin renders the tool, so the card shows nothing rather than itself', () => {
  expect(NativeToolView.pick({ entries: [entries[0]!], toolName: 'read', registrant: REGISTRANT, own: new Set([card]) })).toBeUndefined()
})
