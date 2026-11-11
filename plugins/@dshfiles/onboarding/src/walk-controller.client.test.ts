// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFeature, CatalogReachStep, ReachAction } from './catalog-model.js'
import { ReachModel, type WalkStep } from './reach-model.js'
import { createWalk, WalkKeys, type WalkController } from './walk-controller.js'

const isVisible = (element: Element): boolean => element.closest('[data-off-screen]') === null

const step = (action: ReachAction, by: string | null, name: string | null, value: string | null = null): CatalogReachStep => ({
  text: `${action} ${by ?? ''} "${name ?? value ?? ''}"`,
  action,
  by,
  name,
  value,
})

/** Steps exactly as the Host serves them, through the same model. */
const stepsOf = (reach: readonly CatalogReachStep[]): readonly WalkStep[] => {
  const feature: CatalogFeature = {
    key: 'demo#walk',
    plugin: 'demo',
    id: 'walk',
    title: 'Demo walk',
    summary: 'A walk.',
    destination: 'settings',
    currentSurface: null,
    reach,
    onboarding: null,
  }
  const value = ReachModel.reach({ catalog: { schemaVersion: 1, generatedFrom: [], plugins: [], features: [feature] }, key: feature.key, routeOf: () => null })
  if (value.feature === null) throw new Error('no feature')
  return value.feature.steps
}

let walks: WalkController[] = []
const start = (reach: readonly CatalogReachStep[], onEnd?: () => void): WalkController => {
  const walk = createWalk({ steps: stepsOf(reach), document, isVisible, onEnd })
  walks.push(walk)
  return walk
}

/** MutationObserver callbacks run as microtasks; the walk re-resolves 100 ms later. */
const settle = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  vi.advanceTimersByTime(150)
}

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`no #${id}`)
  return element
}

const press = (init: KeyboardEventInit): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  document.body.dispatchEvent(event)
  return event
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  for (const walk of walks) walk.end()
  walks = []
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('createWalk', () => {
  it('passes an expect step as soon as its target appears, and arrives on the final one', async () => {
    const walk = start([step('expect', 'region', 'Panel'), step('expect', 'heading', 'Here')])
    expect(walk.snapshot()).toMatchObject({ index: 0, phase: 'seeking' })
    document.body.innerHTML = '<section aria-label="Panel" id="panel"></section>'
    await settle()
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'seeking' })
    byId('panel').innerHTML = '<h2 id="here">Here</h2>'
    await settle()
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'arrived', target: byId('here') })
  })

  it('advances a click step only when that element is clicked, never for another one or twice for one gesture', async () => {
    document.body.innerHTML = `
      <button id="other">Other</button>
      <div role="group" aria-label="Toolbar" id="toolbar"><button id="menu"><span id="glyph" aria-hidden="true">⋯</span> Menu</button></div>`
    const walk = start([step('click', 'button', 'Menu'), step('click', 'group', 'Toolbar'), step('expect', 'heading', 'Done')])
    expect(walk.snapshot()).toMatchObject({ index: 0, phase: 'found', target: byId('menu') })
    byId('other').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    byId('other').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(walk.snapshot().index).toBe(0)
    byId('glyph').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 2 }))
    expect(walk.snapshot().index).toBe(0)
    byId('glyph').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'found', target: byId('toolbar') })
    byId('glyph').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(walk.snapshot().index).toBe(1)
    byId('menu').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(walk.snapshot()).toMatchObject({ index: 2, phase: 'seeking', lastTarget: byId('toolbar') })
  })

  it('advances on hover, on a changed field and on the pressed key', () => {
    document.body.innerHTML = '<button id="row">Row</button><input id="field" aria-label="Search settings" />'
    const walk = start([
      step('hover', 'button', 'Row'),
      step('fill', 'textbox', 'Search settings', 'max tabs'),
      step('press', null, null, 'Meta+Shift+P'),
      step('expect', 'button', 'Row'),
    ])
    byId('row').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    expect(walk.snapshot().index).toBe(1)
    byId('field').dispatchEvent(new Event('input', { bubbles: true }))
    expect(walk.snapshot()).toMatchObject({ index: 2, phase: 'waiting-key', lastTarget: byId('field') })
    press({ key: 'P', metaKey: false, shiftKey: true })
    expect(walk.snapshot().index).toBe(2)
    press({ key: 'P', code: 'KeyP', metaKey: true, shiftKey: true })
    expect(walk.snapshot()).toMatchObject({ index: 3, phase: 'arrived' })
  })

  it('treats an Escape the step asks for as progress, not as End', () => {
    const ended = vi.fn()
    document.body.innerHTML = '<p>Arrange manually</p>'
    const walk = start([step('press', null, null, 'Escape'), step('expect', 'text', 'Arrange manually')], ended)
    press({ key: 'Escape' })
    expect(walk.snapshot().phase).toBe('arrived')
    expect(ended).not.toHaveBeenCalled()
  })

  it('stops at a step only the test harness plays, keeping the ring on the last control', () => {
    document.body.innerHTML = '<button id="a">Account menu</button>'
    const walk = start([step('click', 'button', 'Account menu'), step('rightclick', 'text', 'sample'), step('expect', 'text', 'Edit title')])
    byId('a').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'unsupported', target: null, lastTarget: byId('a') })
    walk.next()
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'unsupported' })
    expect(stepsOf([step('seed', null, null, 'tool-call-thread'), step('expect', 'text', 'x')])[0]?.unsupported).toMatch(/only the test harness/u)
  })

  it('says the target is missing after 10 s, finds it again when it shows, and Next always advances', async () => {
    const walk = start([step('click', 'button', 'Ghost'), step('click', 'button', 'Later'), step('expect', 'heading', 'Never')])
    vi.advanceTimersByTime(9_999)
    expect(walk.snapshot().phase).toBe('seeking')
    vi.advanceTimersByTime(1)
    expect(walk.snapshot().phase).toBe('missing')
    document.body.innerHTML = '<button id="ghost">Ghost</button>'
    await settle()
    expect(walk.snapshot()).toMatchObject({ index: 0, phase: 'found', target: byId('ghost') })
    walk.next()
    expect(walk.snapshot()).toMatchObject({ index: 1, phase: 'seeking' })
    walk.next()
    expect(walk.snapshot()).toMatchObject({ index: 2, phase: 'seeking' })
    walk.next()
    expect(walk.snapshot().phase).toBe('ended')
  })

  it('ends on Escape unless a menu or dialog already handled it, and releases every listener, observer and timer', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const addWindow = vi.spyOn(window, 'addEventListener')
    const removeWindow = vi.spyOn(window, 'removeEventListener')
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const ended = vi.fn()
    const walk = start([step('click', 'button', 'Ghost'), step('expect', 'heading', 'Never')], ended)
    document.body.innerHTML = '<p>change</p>'
    await Promise.resolve()
    // Listeners: pointerdown, click, pointerover, input, keydown (document), Escape (window); timers: 10 s, re-resolve, frame.
    expect(walk.resources()).toEqual({ listeners: 6, observers: 1, timers: 3 })
    expect(add.mock.calls.length + addWindow.mock.calls.length).toBe(6)

    document.body.addEventListener('keydown', event => event.preventDefault(), { once: true })
    press({ key: 'Escape' })
    expect(walk.snapshot().phase).toBe('seeking')

    press({ key: 'Escape' })
    expect(walk.snapshot().phase).toBe('ended')
    expect(ended).toHaveBeenCalledOnce()
    expect(walk.resources()).toEqual({ listeners: 0, observers: 0, timers: 0 })
    expect(remove.mock.calls.length).toBe(add.mock.calls.length)
    expect(removeWindow.mock.calls.length).toBe(addWindow.mock.calls.length)
    expect(disconnect).toHaveBeenCalledOnce()
    expect(cancelFrame).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    walk.end()
    expect(ended).toHaveBeenCalledOnce()
    for (const spy of [add, remove, addWindow, removeWindow, disconnect, cancelFrame]) spy.mockRestore()
  })
})

describe('WalkKeys.keyMatches', () => {
  const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init)
  it('reads Playwright key names', () => {
    expect(WalkKeys.keyMatches(key({ key: 'f', ctrlKey: true }), 'ControlOrMeta+f')).toBe(true)
    expect(WalkKeys.keyMatches(key({ key: 'f', metaKey: true }), 'ControlOrMeta+f')).toBe(true)
    expect(WalkKeys.keyMatches(key({ key: 'f' }), 'ControlOrMeta+f')).toBe(false)
    expect(WalkKeys.keyMatches(key({ key: 'Enter' }), 'Enter')).toBe(true)
    expect(WalkKeys.keyMatches(key({ key: 'Enter', shiftKey: true }), 'Enter')).toBe(false)
    expect(WalkKeys.keyMatches(key({ key: 'X', shiftKey: true }), 'x')).toBe(true)
    expect(WalkKeys.keyMatches(key({ key: 'k', metaKey: true }), 'Meta+K')).toBe(true)
    expect(WalkKeys.keyMatches(key({ key: 'k', metaKey: true, altKey: true }), 'Meta+K')).toBe(false)
  })
})
