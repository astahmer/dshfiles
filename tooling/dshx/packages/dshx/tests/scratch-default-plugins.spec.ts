import { describe, expect, it } from 'vitest'
import { defaultScratchPlugins } from '../src/scratch/up.js'

describe('dshx dev up default composition', () => {
  const available = [{ packageId: '@dshfiles/chat' }, { packageId: '@dshfiles/tool-search' }, { packageId: '@dshfiles/user-questions' }]

  it('composes the owned bundles the web profile seeds and leaves opt-in bundles out', () => {
    const seed = new Set(['@dshfiles/chat', '@dshfiles/user-questions', '@deepseek-ai/dsh-client-ui-chat'])
    expect(defaultScratchPlugins(available, seed)).toEqual(['@dshfiles/chat', '@dshfiles/user-questions'])
  })

  it('falls back to every owned bundle when the seed cannot be read', () => {
    expect(defaultScratchPlugins(available, undefined)).toEqual(available.map(bundle => bundle.packageId))
  })
})
