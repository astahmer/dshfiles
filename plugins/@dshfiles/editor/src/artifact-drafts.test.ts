import { describe, expect, it } from 'vitest'
import { createArtifactDrafts } from './artifact-drafts.js'

const artifact = { id: 'a', title: 'A.md', mimeType: 'text/markdown', revision: 1, content: 'saved' }

describe('artifact drafts', () => {
  it('preserves independent plain-text drafts when switching artifacts', () => {
    const drafts = createArtifactDrafts()
    drafts.open(artifact)
    drafts.capture('a', 'Renamed.md', 'unsaved')
    drafts.open({ ...artifact, id: 'b', title: 'B.md' })
    drafts.capture('b', 'B.md', 'other')
    drafts.open(artifact)
    expect(drafts.get('a')).toEqual({ artifact, title: 'Renamed.md', content: 'unsaved' })
    expect(drafts.get('b')?.content).toBe('other')
  })

  it('keeps later edits when an earlier save completes and reload explicitly discards them', () => {
    const drafts = createArtifactDrafts()
    drafts.open(artifact)
    drafts.capture('a', 'A.md', 'later edits')
    const saved = { ...artifact, revision: 2, content: 'earlier edits' }
    drafts.saved(saved)
    expect(drafts.get('a')).toEqual({ artifact: saved, title: 'A.md', content: 'later edits' })
    drafts.reload(saved)
    expect(drafts.get('a')).toEqual({ artifact: saved, title: 'A.md', content: 'earlier edits' })
    drafts.delete('a')
    drafts.capture('a', 'A.md', 'late cleanup')
    expect(drafts.get('a')).toBeUndefined()
  })
})
