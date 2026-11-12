import { describe, expect, it } from 'vitest'
import { FirstRun } from './first-run.js'
import type { Overview } from './overview-model.js'

const overview = (states: Partial<Record<'account' | 'project' | 'repository' | 'github', 'done' | 'todo' | 'unknown' | 'off'>> | null): Overview =>
  // SAFETY: FirstRun reads only `checklist`; the rest of the overview is irrelevant here.
  ({
    checklist: states === null ? null : Object.entries(states).map(([id, state]) => ({ id, state, title: id, detail: '', fix: { label: '', route: null } })),
  }) as unknown as Overview

describe('FirstRun.setup', () => {
  it('waits for the checklist, then opens while an account or project is missing', () => {
    expect(FirstRun.setup({ overview: undefined, failed: false })).toBe('pending')
    expect(FirstRun.setup({ overview: overview({ account: 'todo', project: 'done', repository: 'done', github: 'done' }), failed: false })).toBe('open')
    expect(FirstRun.setup({ overview: overview({ account: 'done', project: 'done', repository: 'unknown', github: 'todo' }), failed: false })).toBe('open')
  })

  it('stays closed for a profile whose account and project are set up, whatever GitHub says', () => {
    expect(FirstRun.setup({ overview: overview({ account: 'done', project: 'done', repository: 'done', github: 'todo' }), failed: false })).toBe('done')
  })

  it('keeps the wizard when the checklist is off or cannot be read', () => {
    expect(FirstRun.setup({ overview: overview(null), failed: false })).toBe('open')
    expect(FirstRun.setup({ overview: undefined, failed: true })).toBe('open')
  })
})
