import { describe, expect, it } from 'vitest'

import type { ViewSnapshot } from '@dshfiles/optmem-core'

import { createInjectionCache } from './injection.ts'

const stream = 'project:ws-a'

const viewOf = (version: number, lines: readonly string[]): ViewSnapshot => ({
  stream,
  kind: 'compact',
  version,
  throughPos: lines.length,
  bytes: lines.join('\n').length,
  mergePending: false,
  nodes: lines.map((_line, idx) => ({ level: 0, idx })),
  lines,
})

const note = (position: number, filler: string): string => `${position}+1| user: ${filler.repeat(20)}`

describe('compat injection refresh', () => {
  const render = (cache: ReturnType<typeof createInjectionCache>) => cache.render({ stream, conversationId: 'reader', budgetBytes: 8_192, refreshBytes: 1_024 })

  it('keeps the emitted text until the view grew by the refresh threshold', () => {
    const cache = createInjectionCache()
    const lines = [note(0, 'alpha ')]
    cache.setView(viewOf(1, lines))
    const first = render(cache)
    expect(first).toContain('alpha')

    lines.push(note(1, 'beta '))
    cache.setView(viewOf(2, lines))
    expect(render(cache)).toBe(first)

    for (let position = 2; position < 12; position++) lines.push(note(position, 'gamma '))
    cache.setView(viewOf(3, [...lines]))
    const grown = render(cache)
    expect(grown).not.toBe(first)
    expect(grown).toContain('beta')
  })

  it('re-emits immediately when a merge rewrote earlier lines', () => {
    const cache = createInjectionCache()
    cache.setView(viewOf(1, [note(0, 'alpha '), note(1, 'beta ')]))
    expect(render(cache)).toContain('alpha')

    cache.setView({ ...viewOf(2, ['0+2| summary of alpha and beta']), nodes: [{ level: 1, idx: 0 }] })
    expect(render(cache)).toContain('summary of alpha and beta')
  })
})
