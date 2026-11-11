// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { Locator } from './reach-model.js'
import { ReachResolver } from './reach-resolver.js'

/** jsdom lays nothing out: an element counts as visible unless it or an ancestor carries `data-off-screen`. */
const isVisible = (element: Element): boolean => element.closest('[data-off-screen]') === null

const page = (html: string): Document => {
  document.body.innerHTML = html
  return document
}

const find = (locator: Partial<Locator> & Pick<Locator, 'kind' | 'name'>): Element | null =>
  ReachResolver.resolve({ root: document, locator: { role: null, match: 'exact', ...locator }, isVisible })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ReachResolver', () => {
  it('reads implicit roles of native controls', () => {
    page(`
      <button id="b">Save</button>
      <a id="a" href="/docs">Docs</a>
      <a id="no-href">Not a link</a>
      <input id="t" aria-label="Title" />
      <input id="s" type="search" aria-label="Find" />
      <select id="c" aria-label="Mode"><option>One</option></select>
      <textarea id="x" aria-label="Notes"></textarea>
      <details><summary id="m">More</summary></details>
      <h2 id="h">Getting started</h2>
    `)
    expect(find({ kind: 'role', role: 'button', name: 'Save' })?.id).toBe('b')
    expect(find({ kind: 'role', role: 'link', name: 'Docs' })?.id).toBe('a')
    expect(find({ kind: 'role', role: 'link', name: 'Not a link' })).toBeNull()
    expect(find({ kind: 'role', role: 'textbox', name: 'Title' })?.id).toBe('t')
    expect(find({ kind: 'role', role: 'searchbox', name: 'Find' })?.id).toBe('s')
    expect(find({ kind: 'role', role: 'combobox', name: 'Mode' })?.id).toBe('c')
    expect(find({ kind: 'role', role: 'textbox', name: 'Notes' })?.id).toBe('x')
    expect(find({ kind: 'role', role: 'button', name: 'More' })?.id).toBe('m')
    expect(find({ kind: 'role', role: 'heading', name: 'Getting started' })?.id).toBe('h')
    expect(find({ kind: 'role', role: 'tab', name: 'Save' })).toBeNull()
  })

  it('names elements from aria-labelledby, aria-label, content, alt and title', () => {
    page(`
      <span id="lead">Search</span><span id="tail">settings</span>
      <input id="labelled" aria-labelledby="lead tail" aria-label="ignored" />
      <div role="tab" id="tab"><svg aria-hidden="true"><text>x</text></svg> Knowledge <span aria-hidden="true">3</span></div>
      <button id="icon"><img alt="Close panel" /></button>
      <button id="titled" title="Collapse sidebar"></button>
      <label for="field">Max tabs</label><input id="field" type="number" />
    `)
    expect(find({ kind: 'role', role: 'textbox', name: 'Search settings' })?.id).toBe('labelled')
    expect(find({ kind: 'role', role: 'tab', name: 'Knowledge' })?.id).toBe('tab')
    expect(find({ kind: 'role', role: 'button', name: 'Close panel' })?.id).toBe('icon')
    expect(find({ kind: 'role', role: 'button', name: 'Collapse sidebar' })?.id).toBe('titled')
    expect(find({ kind: 'role', role: 'spinbutton', name: 'Max tabs' })?.id).toBe('field')
    expect(find({ kind: 'label', name: 'Max tabs' })?.id).toBe('field')
    expect(find({ kind: 'label', name: 'Search settings' })?.id).toBe('labelled')
    expect(find({ kind: 'title', name: 'Collapse sidebar' })?.id).toBe('titled')
  })

  it('collapses whitespace and ignores case', () => {
    page(`<button id="b">  Enable   pack:
      Observe &amp; perf </button>`)
    expect(find({ kind: 'role', role: 'button', name: 'enable pack: observe & PERF' })?.id).toBe('b')
    expect(find({ kind: 'text', name: 'ENABLE PACK: observe & perf' })?.id).toBe('b')
  })

  it('prefers an exact name over an earlier substring match, and matches a substring only when the step asks for one', () => {
    page(`
      <button id="long">Settings: General</button>
      <button id="exact">Settings</button>
      <button id="keep">Keep memory across threads</button>
      <div role="option" id="opt">Onboarding: Show the setup wizard ⌘W</div>
    `)
    expect(find({ kind: 'role', role: 'button', name: 'Settings', match: 'substring' })?.id).toBe('exact')
    expect(find({ kind: 'role', role: 'button', name: 'General', match: 'substring' })?.id).toBe('long')
    expect(find({ kind: 'role', role: 'button', name: 'General' })).toBeNull()
    expect(find({ kind: 'role', role: 'button', name: 'Memory' })).toBeNull()
    expect(find({ kind: 'role', role: 'option', name: 'Onboarding: Show the setup wizard', match: 'substring' })?.id).toBe('opt')
  })

  it('takes the first visible element among duplicate names', () => {
    page(`
      <div data-off-screen><button id="hidden">New thread</button></div>
      <button id="first">New thread</button>
      <button id="second">New thread</button>
    `)
    expect(find({ kind: 'role', role: 'button', name: 'New thread' })?.id).toBe('first')
  })

  it('skips elements hidden from the accessibility tree and the walk overlay itself', () => {
    page(`
      <div aria-hidden="true"><button id="behind">Next</button></div>
      <div data-onboarding-walk><button id="own">Next</button></div>
    `)
    expect(find({ kind: 'role', role: 'button', name: 'Next' })).toBeNull()
    expect(find({ kind: 'text', name: 'Next' })?.id).toBe('behind')
  })

  it('returns null when nothing matches', () => {
    page('<button>Open</button>')
    expect(find({ kind: 'role', role: 'button', name: 'Archive' })).toBeNull()
    expect(find({ kind: 'role', role: 'dialog', name: 'Open' })).toBeNull()
    expect(find({ kind: 'label', name: 'Open' })).toBeNull()
  })
})
