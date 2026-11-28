import { ModelMark } from '@dshfiles/plugin-ui/components/model-mark'
import { describe, expect, it } from 'vitest'
import { BrandMark } from '../src/picker-atoms.js'

/** The mark as the composer trigger asks for it: 14 px, which the kit's 16 px mark does not take. */
const mark = (brand: Parameters<typeof BrandMark>[0]['brand']) => BrandMark({ brand, name: 'gpt-6-luna', className: 'dshx:size-3.5' })

describe('the composer model mark through the kit (council round 18 C3)', () => {
  it.each(['openai', 'claude', 'google', 'deepseek', 'mistral'] as const)('draws the kit ModelMark for %s, as the dock and list rows do', brand => {
    const element = mark(brand)
    // The kit's 16 px mark in the family's brand colour (BRAND_COLOURS; plugin-ui tests/route-model), never the
    // picker's own artwork, whose OpenAI mark took the label's ink through `currentColor`.
    // Round 4 T2: inside a box that takes the caller's className (size, offset), since the kit mark is always 16 px.
    expect(element.type).toBe('span')
    const inner = element.props.children
    expect(inner.type).toBe(ModelMark)
    expect(inner.props).toEqual({ modelId: brand, className: 'dshx:brightness-85 dshx:dark:brightness-100' })
  })

  it('keeps its own artwork for families the kit does not draw, and the initial for none', () => {
    expect(mark('kimi').type).toBe('svg')
    expect(mark(undefined).type).toBe('span')
  })
})
