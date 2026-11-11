import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import { describe, expect, it } from 'vitest'
import { ProjectionPatches, type PatchJson } from './projection-patch.ts'

const roundTrip = (previous: PatchJson, next: PatchJson) => {
  const patch = ProjectionPatches.diff(previous, next)
  return { patch, value: patch === 'replace' ? next : ProjectionPatches.apply(previous, patch) }
}

const turn = (index: number) => ({ turn: index, groups: [{ provider: 'anthropic', model: 'claude-opus', usage: { input: index * 1000, output: index * 37 } }] })

describe('projection patches', () => {
  it('sends only the changed tail of a growing per-turn list', () => {
    const previous = { groups: [turn(9).groups[0] ?? null], turn: turn(9), turns: Array.from({ length: 10 }, (_, index) => turn(index)) }
    const next = { groups: [turn(10).groups[0] ?? null], turn: turn(10), turns: Array.from({ length: 11 }, (_, index) => turn(index)) }
    const { patch, value } = roundTrip(previous, next)
    expect(value).toEqual(next)
    expect(JSON.stringify(value)).toBe(JSON.stringify(next))
    expect(patch).toMatchObject({ o: { turns: { a: 10 } } })
    expect(JSON.stringify(patch).length).toBeLessThan(JSON.stringify(next).length / 3)
  })

  it('round-trips appends, tail edits, truncation, key deletion and additions', () => {
    const cases: readonly (readonly [PatchJson, PatchJson])[] = [
      [
        [1, 2, 3],
        [1, 2, 3, 4],
      ],
      [
        [1, 2, 3],
        [1, 2, 9],
      ],
      [[1, 2, 3], [1]],
      [
        { a: 1, b: { c: [1, 2] }, gone: true },
        { a: 1, b: { c: [1, 2, 3] }, added: 'x' },
      ],
      [{ a: [{ id: 1 }, { id: 2 }] }, { a: [{ id: 1 }, { id: 3 }] }],
    ]
    for (const [previous, next] of cases) expect(roundTrip(previous, next).value).toEqual(next)
  })

  it('replaces scalars, type changes and patches that would not be smaller', () => {
    expect(ProjectionPatches.diff(1, 2)).toBe('replace')
    expect(ProjectionPatches.diff([1], { a: 1 })).toBe('replace')
    expect(ProjectionPatches.diff({ a: 1 }, { a: 2 })).toBe('replace')
    expect(ProjectionPatches.diff({ a: [1, 2] }, { a: [1, 2] })).toEqual({ o: {} })
    expect(ProjectionPatches.diff('same', 'same')).toBe('replace')
  })

  it('refuses a patch that does not fit the value it was computed from', () => {
    const long = Array.from({ length: 20 }, (_, index) => `entry-${index}`)
    const patch = ProjectionPatches.diff(long, [...long, 'next'])
    if (patch === 'replace') throw new Error('expected a patch')
    expect(() => ProjectionPatches.apply(['entry-0'], patch)).toThrow(/does not fit/)
    expect(() => ProjectionPatches.apply('text', { o: {} })).toThrow(/does not fit/)
  })
})

describe('ProjectionPatches.decode', () => {
  it('accepts what ProjectionPatches.diff produces and rejects other shapes', () => {
    const patch = ProjectionPatches.diff({ a: Array.from({ length: 20 }, (_, index) => index) }, { a: Array.from({ length: 21 }, (_, index) => index) })
    expect(ProjectionPatches.decode(decodeJson(jsonValueSchema, JSON.stringify(patch)))).toEqual(patch)
    expect(() => ProjectionPatches.decode({ a: -1, i: [] })).toThrow()
    expect(() => ProjectionPatches.decode({ x: 1 })).toThrow()
  })
})
