import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LandLabels } from './land-labels.js'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Land pages in plain words', () => {
  it('names Source control groups without jj notation', () => {
    expect(LandLabels.sourceControlGroup(0)).toBe('Working copy')
    expect(LandLabels.sourceControlGroup(1)).toBe('Parent')
    expect(LandLabels.sourceControlGroup(3)).toBe('3 changes back')
    const view = read('source-control-view.tsx')
    expect(view).not.toMatch(/`@-\$\{|Describe @|describes @|>@-</u)
    // The Commit button is as wide as its label, not the whole row.
    expect(view).not.toContain('<Button className="dshx:flex-1" disabled={props.busy || commitMessage.length === 0}')
  })

  it('names a thread workspace chip by its thread', () => {
    const sessions = [
      { title: 'Fix the login page', cwd: '/repo-threads/thread-055403', updatedAt: 2 },
      { title: 'Older title', cwd: '/repo-threads/thread-055403/', updatedAt: 1 },
      { title: '', cwd: '/repo-threads/thread-aaaaaa', updatedAt: 3 },
    ]
    expect(LandLabels.threadTitleOfWorkspace('thread-055403', sessions)).toBe('Fix the login page')
    expect(LandLabels.threadTitleOfWorkspace('thread-aaaaaa', sessions)).toBeUndefined()
    expect(LandLabels.threadTitleOfWorkspace('default', sessions)).toBeUndefined()
  })

  it('draws no age for the root commit', () => {
    expect(LandLabels.isRootCommit('0'.repeat(40))).toBe(true)
    expect(LandLabels.isRootCommit('a1b2c3')).toBe(false)
  })

  it('gives History controls the kit 44 px touch target', () => {
    expect(read('touch-hit-area.ts')).toContain("export const TOUCH_HIT_AREA = 'dshx-hit-44'")
  })
})
