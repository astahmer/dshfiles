// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogFeature, CatalogReachStep } from './catalog-model.js'
import { PHONE_QUERY, ReachModel, type FeatureReach } from './reach-model.js'
import type { RouteServices } from './routes.js'
import { ShowMeWhere } from './show-me-where.js'

const click = (by: string, name: string): CatalogReachStep => ({ text: `click ${by} "${name}"`, action: 'click', by, name, value: null })
const expectStep = (by: string, name: string): CatalogReachStep => ({ text: `expect ${by} "${name}"`, action: 'expect', by, name, value: null })

const reachOf = (reachNarrow: readonly CatalogReachStep[] | null): FeatureReach => {
  const feature: CatalogFeature = {
    key: 'memory#memory-panel',
    plugin: 'memory',
    id: 'memory-panel',
    title: 'Memory panel',
    summary: 'Notes.',
    destination: 'knowledge',
    currentSurface: null,
    reach: [click('tab', 'Knowledge'), click('button', 'Memory'), expectStep('tab', 'Notes')],
    reachNarrow,
    onboarding: null,
  }
  const value = ReachModel.reach({ catalog: { schemaVersion: 1, generatedFrom: [], plugins: [], features: [feature] }, key: feature.key, routeOf: () => null })
  if (value.feature === null) throw new Error('no feature')
  return value.feature
}

const PHONE_REACH = [click('button', 'More'), click('button', 'Knowledge'), click('button', 'Memory'), expectStep('tab', 'Notes')]

const routes: RouteServices = {
  hasPanel: () => false,
  openPanel: () => false,
  hasCommand: () => false,
  runCommand: () => false,
  hasSettings: () => false,
  openSettings: () => false,
}

/** A viewport whose width answers the phone query; `resize` crosses the breakpoint as a rotation does. */
const viewport = (initial: { readonly phone: boolean }) => {
  const listeners = new Set<() => void>()
  let phone = initial.phone
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === PHONE_QUERY && phone
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    resize: (next: { readonly phone: boolean }) => {
      phone = next.phone
      for (const listener of listeners) listener()
    },
    listeners: () => listeners.size,
  }
}

const chip = () => screen.getByRole('region', { name: 'Show me where' }).querySelector('[data-walk-chip]')?.textContent

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ShowMeWhere on a phone-width viewport', () => {
  it('walks reachNarrow below 640 px and reach at desktop width', () => {
    const screenSize = viewport({ phone: true })
    render(<ShowMeWhere onEnd={vi.fn()} reach={reachOf(PHONE_REACH)} routes={routes} />)
    expect(chip()).toBe('Step 1 of 4 · Click "More"')
    act(() => screenSize.resize({ phone: false }))
    expect(chip()).toBe('Step 1 of 3 · Click "Knowledge"')
  })

  it('keeps the desktop steps on a phone when the feature has no reachNarrow', () => {
    viewport({ phone: true })
    render(<ShowMeWhere onEnd={vi.fn()} reach={reachOf(null)} routes={routes} />)
    expect(chip()).toBe('Step 1 of 3 · Click "Knowledge"')
  })

  it('stops watching the viewport once the walk unmounts', () => {
    const screenSize = viewport({ phone: true })
    const view = render(<ShowMeWhere onEnd={vi.fn()} reach={reachOf(PHONE_REACH)} routes={routes} />)
    expect(screenSize.listeners()).toBe(1)
    view.unmount()
    expect(screenSize.listeners()).toBe(0)
  })
})

describe('onboarding_reach output', () => {
  it('labels the desktop and phone walks when both exist, and stays unlabelled otherwise', () => {
    const both = ReachModel.render({ feature: reachOf(PHONE_REACH) })
    expect(both).toContain('Desktop (640 px wide or more):\n1. Click "Knowledge" (tab)')
    expect(both).toContain('Phone (narrower than 640 px):\n1. Click "More" (button)\n2. Click "Knowledge" (button)')
    const desktopOnly = ReachModel.render({ feature: reachOf(null) })
    expect(desktopOnly).not.toContain('Phone')
    expect(desktopOnly).toContain('1. Click "Knowledge" (tab)')
    expect(ReachModel.stepsFor({ reach: reachOf(PHONE_REACH), phone: false }).length).toBe(3)
  })
})
