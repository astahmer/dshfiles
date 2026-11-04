import { describe, expect, it } from 'vitest'
import { GalleryModel } from './gallery-model.js'
import type { GalleryCategory, GalleryDemo } from './demos/types.js'

const demo = (id: string, title: string, source = `@dshfiles/plugin-ui/components/motion/${id}`): GalleryDemo => ({
  id,
  title,
  description: `${title} demo`,
  source,
  render: () => null,
})

describe('GalleryModel', () => {
  const demos = [demo('agent-queue', 'AgentQueue'), demo('trace-waterfall', 'TraceWaterfall'), demo('merge-queue', 'MergeQueue')]

  it('filters by every word across title, description and import path', () => {
    expect(GalleryModel.filter(demos, 'queue').map(d => d.id)).toEqual(['agent-queue', 'merge-queue'])
    expect(GalleryModel.filter(demos, 'merge QUEUE').map(d => d.id)).toEqual(['merge-queue'])
    expect(GalleryModel.filter(demos, '  ')).toBe(demos)
  })

  it('counts demos and reports duplicate ids across categories', () => {
    const categories: GalleryCategory[] = [
      { id: 'a', label: 'A', description: '', demos },
      { id: 'b', label: 'B', description: '', demos: [demo('agent-queue', 'Again')] },
    ]
    expect(GalleryModel.total(categories)).toBe(4)
    expect(GalleryModel.duplicateIds(categories)).toEqual(['agent-queue'])
  })
})
