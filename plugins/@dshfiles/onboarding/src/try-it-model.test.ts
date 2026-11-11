import { describe, expect, it } from 'vitest'
import { FEATURE_CATALOG } from './generated/feature-catalog.js'
import { PACKS } from './packs.js'
import { TryItModel } from './try-it-model.js'

const demo = (request: { readonly feature?: string; readonly pack?: string }) => TryItModel.demoOf({ catalog: FEATURE_CATALOG, packs: PACKS, request })

describe('TryItModel', () => {
  it('builds a feature demo prompt only from its catalog row, onboarding block and replayable reach steps', () => {
    const feature = FEATURE_CATALOG.features.find(candidate => candidate.key === 'onboarding#usage-suggestions')
    if (feature === undefined || feature.onboarding === null) throw new Error('no usage-suggestions feature')
    const built = demo({ feature: feature.key })
    expect(built?.title).toBe(`Try it · ${feature.title}`)
    const text = built?.text ?? ''
    expect(text).toContain(`**${feature.title}** (plugin \`onboarding\`, catalog key \`onboarding#usage-suggestions\`)`)
    expect(text).toContain(`What it does: ${feature.summary}`)
    expect(text).toContain(`First thing to try: ${feature.onboarding.firstAction}`)
    expect(text).toContain(`It worked when: ${feature.onboarding.doneWhen}`)
    expect(text).toContain('How to reach it in the app:\n1. Click "Knowledge"\n2. Click "Getting started"\n3. Find "Suggestions"')
    expect(text).toContain('onboarding_overview (and onboarding_reach for a feature)')
    expect(text).toContain('Show, do not change: use read-only tools')
    expect(text).toContain('Ask me before any write')
    expect(demo({ feature: feature.key })).toEqual(built)
  })

  it('drops reach steps only the test harness can play', () => {
    const seeded = FEATURE_CATALOG.features.find(feature => feature.reach.some(step => step.action === 'seed'))
    if (seeded === undefined) throw new Error('no feature with a seed step')
    const text = demo({ feature: seeded.key })?.text ?? ''
    expect(text).not.toContain('Set up sample data')
  })

  it('omits the onboarding lines for a feature without an onboarding block', () => {
    const plain = FEATURE_CATALOG.features.find(feature => feature.onboarding === null)
    if (plain === undefined) throw new Error('no feature without an onboarding block')
    const text = demo({ feature: plain.key })?.text ?? ''
    expect(text).not.toContain('First thing to try')
    expect(text).toContain(`What it does: ${plain.summary}`)
  })

  it('builds a pack demo prompt from the pack definition and each plugin description', () => {
    const observe = PACKS.find(pack => pack.id === 'observe')
    if (observe === undefined) throw new Error('no observe pack')
    const text = demo({ pack: 'observe' })?.text ?? ''
    expect(demo({ pack: 'observe' })?.title).toBe('Try it · Observe & perf')
    expect(text).toContain(`What it is for: ${observe.summary}`)
    for (const plugin of observe.plugins) expect(text).toContain(`- \`${plugin}\``)
    expect(text).toContain('Ask me before any write')
  })

  it('names nothing for an unknown key, an unknown pack, both, or neither', () => {
    expect(demo({ feature: 'onboarding#no-such-feature' })).toBeNull()
    expect(demo({ pack: 'no-such-pack' })).toBeNull()
    expect(demo({ feature: 'onboarding#usage-suggestions', pack: 'observe' })).toBeNull()
    expect(demo({})).toBeNull()
  })

  it('keeps a long title within the sidebar limit', () => {
    const core = PACKS[0]
    if (core === undefined) throw new Error('no packs')
    const packs = [{ ...core, id: 'long', title: 'x'.repeat(200) }]
    expect(TryItModel.demoOf({ catalog: FEATURE_CATALOG, packs, request: { pack: 'long' } })?.title).toHaveLength(80)
  })
})
