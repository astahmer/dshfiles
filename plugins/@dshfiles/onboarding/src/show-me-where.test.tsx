// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { OnboardingOverview } from './overview-model.js'
import { ReachModel, type FeatureReach } from './reach-model.js'
import type { RouteServices } from './routes.js'
import { ShowMeWhere } from './show-me-where.js'

const isVisible = (element: Element): boolean => element.closest('[data-off-screen]') === null

/** A real catalog feature, served as the Host serves it. */
const reachOf = (key: string): FeatureReach => {
  const value = ReachModel.reach({ catalog: FEATURE_CATALOG, key, routeOf: feature => OnboardingOverview.rowOf(feature).route })
  if (value.feature === null) throw new Error(`no ${key}`)
  return value.feature
}

const routes = (registered: readonly string[]): RouteServices & { readonly opened: string[] } => {
  const opened: string[] = []
  return {
    opened,
    hasPanel: panelId => registered.includes(panelId),
    openPanel: panelId => {
      opened.push(panelId)
      return true
    },
    hasCommand: () => false,
    runCommand: () => false,
    hasSettings: () => false,
    openSettings: () => false,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const card = () => screen.getByRole('region', { name: 'Show me where' })

describe('ShowMeWhere', () => {
  it('rings the next control, announces each step and follows the user to the final expect', async () => {
    const app = document.createElement('div')
    app.innerHTML = '<div role="tablist"><button role="tab" id="knowledge">Knowledge</button></div>'
    document.body.append(app)
    const onEnd = vi.fn()
    render(<ShowMeWhere isVisible={isVisible} onEnd={onEnd} reach={reachOf('onboarding#getting-started')} routes={routes([])} />)
    expect(within(card()).getByText('Step 1 of 3 · Click "Knowledge"')).toBeTruthy()
    expect(card().querySelector('[aria-live="polite"]')?.textContent).toBe('Step 1 of 3 · Click "Knowledge", tab "Knowledge".')
    expect(document.querySelector('[data-walk-ring]')?.className).toContain('dshx:pointer-events-none')
    expect(screen.getByRole('button', { name: 'Next' })).toBe(document.activeElement)

    act(() => {
      document.getElementById('knowledge')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(within(card()).getByText('Step 2 of 3 · Click "Getting started"')).toBeTruthy()
    await act(async () => {
      app.insertAdjacentHTML('beforeend', '<nav aria-label="Knowledge pages"><button id="page">Getting started</button></nav>')
      await Promise.resolve()
      vi.advanceTimersByTime(150)
    })
    act(() => {
      document.getElementById('page')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      app.insertAdjacentHTML('beforeend', '<h1>Getting started</h1>')
      await Promise.resolve()
      vi.advanceTimersByTime(150)
    })
    expect(card().dataset.walkPhase).toBe('arrived')
    expect(within(card()).getByText('Step 3 of 3 · Here: "Getting started"')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'End' }))
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('after 10 s without the target names the destination and offers Open through the registered route', () => {
    const services = routes(['dshfiles-onboarding'])
    render(<ShowMeWhere isVisible={isVisible} onEnd={vi.fn()} reach={reachOf('onboarding#getting-started')} routes={services} />)
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(card().dataset.walkPhase).toBe('missing')
    expect(within(card()).getByRole('note').textContent).toMatch(
      /^tab "Knowledge" is not on screen\. .+ lives in Knowledge \(rail: Knowledge › Getting started/u,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(services.opened).toEqual(['dshfiles-onboarding'])
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy()
  })

  it('without a registered route says where to go instead of offering a dead button', () => {
    render(<ShowMeWhere isVisible={isVisible} onEnd={vi.fn()} reach={reachOf('memory#memory-panel')} routes={routes([])} />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(within(card()).getByRole('note').textContent).toMatch(/Go there yourself and the walk continues, or press Next\./u)
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  })

  it('stops at a right-click step with the reason and the docs, never faking progress', () => {
    document.body.insertAdjacentHTML('afterbegin', '<p>Idle policy target</p>')
    const reach = reachOf('thread-sidebar#idle-archive-policy')
    const rightClick = reach.steps.findIndex(step => step.action === 'rightclick')
    expect(reach.unsupportedActions).toEqual(['rightclick'])
    render(<ShowMeWhere isVisible={isVisible} onEnd={vi.fn()} reach={reach} routes={routes([])} />)
    for (let index = 0; index < rightClick; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(card().dataset.walkPhase).toBe('unsupported')
    expect(within(card()).getByRole('note').textContent).toMatch(/right-clicks a row the test harness created/u)
    expect(within(card()).getByRole('link', { name: /Docs/u }).getAttribute('href')).toBe(
      'https://github.com/astahmer/dshfiles/blob/main/plugins/@dshfiles/thread-sidebar/README.md',
    )
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
  })

  it('unmounting ends the walk silently and releases everything it watched', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    const onEnd = vi.fn()
    const view = render(<ShowMeWhere isVisible={isVisible} onEnd={onEnd} reach={reachOf('onboarding#getting-started')} routes={routes([])} />)
    const walkListeners = add.mock.calls.filter(([type]) => ['pointerdown', 'click', 'pointerover', 'input', 'keydown'].includes(type)).length
    expect(walkListeners).toBeGreaterThanOrEqual(5)
    // jsdom's focus() queues a 0 ms selection timer of its own; what stays pending after it is the walk's 10 s timer.
    vi.advanceTimersByTime(1)
    expect(vi.getTimerCount()).toBe(1)
    view.unmount()
    const released = remove.mock.calls.filter(([type]) => ['pointerdown', 'click', 'pointerover', 'input', 'keydown'].includes(type)).length
    expect(released).toBe(walkListeners)
    expect(disconnect).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(onEnd).not.toHaveBeenCalled()
    for (const spy of [add, remove, disconnect]) spy.mockRestore()
  })
})
