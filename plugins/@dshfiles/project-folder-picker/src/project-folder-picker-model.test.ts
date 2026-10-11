import { describe, expect, it } from 'vitest'
import {
  filterRegisteredProjects,
  initialBrowseTarget,
  folderSelection,
  movePickerSelection,
  pickerEntries,
  pickerEntrySelection,
  workspaceSelection,
} from './project-folder-picker-model.js'
import type { RegisteredProject } from './project-folder-picker.js'

const dshfilesProject: RegisteredProject = { workspaceId: 'ws-1', title: 'dshfiles', canonicalPath: '/Users/me/dev/dshfiles' }
const projects: readonly RegisteredProject[] = [dshfilesProject, { workspaceId: 'ws-2', title: 'emisoup', canonicalPath: '/Users/me/dev/emisoup' }]

describe('project and folder selection', () => {
  it('preserves project mode by default and starts directory mode at Host home', () => {
    expect(initialBrowseTarget(undefined)).toBeNull()
    expect(initialBrowseTarget('projects')).toBeNull()
    expect(initialBrowseTarget('directories')).toEqual({ path: undefined })
  })

  it('searches registered project names and canonical paths', () => {
    expect(filterRegisteredProjects(projects, 'EMI')).toEqual([projects[1]])
    expect(filterRegisteredProjects(projects, '/Users/me/dev/dsh')).toEqual([])
  })

  it('wraps keyboard selection and handles an empty list', () => {
    expect(movePickerSelection(1, 2, 'down')).toBe(0)
    expect(movePickerSelection(0, 2, 'up')).toBe(1)
    expect(movePickerSelection(4, 0, 'down')).toBe(0)
  })

  it('keeps project identity and canonical folder path explicit', () => {
    expect(workspaceSelection(dshfilesProject)).toEqual({
      kind: 'workspace',
      workspaceId: 'ws-1',
      canonicalPath: '/Users/me/dev/dshfiles',
      title: 'dshfiles',
    })
    expect(folderSelection('/Users/me/dev')).toEqual({
      kind: 'directory',
      canonicalPath: '/Users/me/dev',
      title: 'dev',
    })
  })

  it('offers unregistered recent folders after matching projects', () => {
    const entries = pickerEntries(projects, ['/Users/me/dev/dshfiles', '/Users/me/dev/bb-plugins', '/Users/me/dev/bb-plugins'], 'dev')
    expect(entries.map(entry => (entry.kind === 'project' ? entry.project.title : entry.path))).toEqual(['dshfiles', 'emisoup', '/Users/me/dev/bb-plugins'])
    expect(pickerEntries(projects, ['/Users/me/dev/bb-plugins'], 'emi').map(entry => entry.kind)).toEqual(['project'])
    expect(pickerEntries(projects, ['/Users/me/dev/bb-plugins'], '/Users')).toEqual([])
    const recent = entries[2]
    expect(recent === undefined ? null : pickerEntrySelection(recent)).toEqual({
      kind: 'directory',
      canonicalPath: '/Users/me/dev/bb-plugins',
      title: 'bb-plugins',
    })
  })
})
