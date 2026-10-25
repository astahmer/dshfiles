import type { ToolSourceMetadata } from './fold.js'
import { describe, expect, it } from 'vitest'
import { toolSourceSnapshotsEqual } from './tool-source-snapshots.js'

const shellRun: ToolSourceMetadata = { source: 'api', owner: '@dshfiles/terminal' }
const search: ToolSourceMetadata = { source: 'mcp', owner: 'registry.search' }
const first = new Map<string, ToolSourceMetadata>([['shell.run', shellRun], ['search', search]])

describe('tool source registry snapshots', () => {
  it('compares metadata independent of map insertion order', () => {
    const reordered = new Map([...first].reverse())

    expect(toolSourceSnapshotsEqual({ previous: first, next: reordered })).toBe(true)
  })

  it('detects added, removed and changed metadata', () => {
    expect(toolSourceSnapshotsEqual({ previous: undefined, next: first })).toBe(false)
    expect(toolSourceSnapshotsEqual({ previous: first, next: new Map([['shell.run', shellRun]]) })).toBe(false)
    expect(toolSourceSnapshotsEqual({
      previous: first,
      next: new Map([
        ['shell.run', { source: 'api', owner: '@dshfiles/terminal' }],
        ['search', { source: 'api', owner: 'registry.search' }],
      ]),
    })).toBe(false)
    expect(toolSourceSnapshotsEqual({
      previous: first,
      next: new Map([
        ['shell.run', { source: 'api', owner: '@dshfiles/terminal' }],
        ['search', { source: 'mcp', owner: 'new-owner' }],
      ]),
    })).toBe(false)
  })
})
