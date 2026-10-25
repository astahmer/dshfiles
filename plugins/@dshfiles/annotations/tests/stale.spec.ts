import { describe, expect, it } from 'vitest'
import { staleAnnotations } from '../src/stale.js'
import type { Annotation, AnnotationTarget } from '../src/schema.js'

const target = (overrides: Partial<AnnotationTarget> = {}): AnnotationTarget => ({
  surface: 'dsh',
  url: 'http://127.0.0.1:3080/thread/1',
  selector: '#subject',
  tag: 'button',
  text: 'Rebase',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  ...overrides,
})

const annotation = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: 'ann_1',
  sessionId: 'session-1',
  revision: 1,
  status: 'pending',
  kind: 'element',
  target: target(),
  note: 'note',
  thread: [],
  createdAt: 0,
  updatedAt: 0,
  origin: 'dsh',
  ...overrides,
})

const mount = (html: string): void => {
  document.body.innerHTML = ''
  document.body.innerHTML = html
}

describe('staleAnnotations', () => {
  it('reports nothing for a matching target', () => {
    mount('<button id="subject">Rebase</button>')
    expect(staleAnnotations({ annotations: [annotation()], scope: document, url: 'http://127.0.0.1:3080/thread/1' })).toEqual([])
  })

  it('reports a missing element', () => {
    mount('<div></div>')
    const checks = staleAnnotations({ annotations: [annotation()], scope: document, url: 'http://127.0.0.1:3080/thread/1' })
    expect(checks).toEqual([{ id: 'ann_1', revision: 1, reason: 'element-missing' }])
  })

  it('reports changed text', () => {
    mount('<button id="subject">Something else entirely</button>')
    const checks = staleAnnotations({ annotations: [annotation()], scope: document, url: 'http://127.0.0.1:3080/thread/1' })
    expect(checks.map(check => check.reason)).toContain('text-changed')
  })

  it('reports a route change', () => {
    mount('<button id="subject">Rebase</button>')
    const checks = staleAnnotations({ annotations: [annotation()], scope: document, url: 'http://127.0.0.1:3080/other' })
    expect(checks.map(check => check.reason)).toContain('route-changed')
  })

  it('skips closed annotations and other surfaces', () => {
    mount('<div></div>')
    const resolved = annotation({ status: 'resolved' })
    const external = annotation({ id: 'ann_2', target: target({ surface: 'external' }) })
    expect(staleAnnotations({ annotations: [resolved, external], scope: document, url: 'http://127.0.0.1:3080/thread/1' })).toEqual([])
  })
})
