import { describe, expect, it } from 'vitest'
import { formatAnnotation, formatAnnotationBlock } from '../src/draft.js'
import type { Annotation, AnnotationTarget } from '../src/schema.js'

const target: AnnotationTarget = {
  surface: 'dsh',
  url: 'http://127.0.0.1:3080/',
  selector: 'body > div > button.primary',
  tag: 'button',
  text: 'Rebase',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  source: { file: 'plugins/@dshfiles/jj-integration/src/thread-destination.tsx', line: 88, column: 4, confidence: 'map' },
}

const annotation = (index: number, overrides: Partial<Annotation> = {}): Annotation => ({
  id: `ann_${index + 1}`,
  sessionId: 'session-1',
  revision: 1,
  status: 'pending',
  kind: 'element',
  target,
  note: `note ${index + 1}`,
  thread: [],
  createdAt: index,
  updatedAt: index,
  origin: 'dsh',
  ...overrides,
})

describe('formatAnnotation', () => {
  it('prints selector, page, source and note', () => {
    const text = formatAnnotation({ annotation: annotation(0, { severity: 'blocking', intent: 'fix' }), index: 0 })
    expect(text).toContain('1. [blocking · fix] button "Rebase"')
    expect(text).toContain('selector: body > div > button.primary')
    expect(text).toContain('page: http://127.0.0.1:3080/')
    expect(text).toContain('source: plugins/@dshfiles/jj-integration/src/thread-destination.tsx:88')
    expect(text).toContain('note: note 1')
  })

  it('labels a stale target', () => {
    const stale = annotation(0, { status: 'stale', target: { ...target, staleReason: 'element-missing' } })
    expect(formatAnnotation({ annotation: stale, index: 0 })).toContain('stale: element-missing')
  })
})

describe('formatAnnotationBlock', () => {
  it('returns nothing for an empty list', () => {
    expect(formatAnnotationBlock({ annotations: [] })).toBe('')
  })

  it('caps the number of rows and says how many were omitted', () => {
    const rows = Array.from({ length: 10 }, (_, index) => annotation(index))
    const block = formatAnnotationBlock({ annotations: rows })
    expect(block).toContain('Annotated UI feedback (8)')
    expect(block).toContain('(+2 more not inserted)')
    expect(block).not.toContain('note 9')
  })

  it('never exceeds the draft cap', () => {
    const rows = Array.from({ length: 8 }, (_, index) => annotation(index, { note: 'x'.repeat(2000) }))
    expect(formatAnnotationBlock({ annotations: rows }).length).toBeLessThanOrEqual(4000)
  })
})
