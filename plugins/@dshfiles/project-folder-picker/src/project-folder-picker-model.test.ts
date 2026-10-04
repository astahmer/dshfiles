import { describe, expect, it } from 'vitest'
import { filterRegisteredProjects, folderSelection, movePickerSelection, workspaceSelection } from './project-folder-picker-model.js'
import type { RegisteredProject } from './project-folder-picker.js'

const projects: readonly RegisteredProject[] = [
  { workspaceId: 'ws-1', title: 'dshfiles', canonicalPath: '/Users/me/dev/dshfiles' },
  { workspaceId: 'ws-2', title: 'emisoup', canonicalPath: '/Users/me/dev/emisoup' },
]

describe('project and folder selection', () => {
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
    expect(workspaceSelection(projects[0])).toEqual({
      kind: 'workspace', workspaceId: 'ws-1', canonicalPath: '/Users/me/dev/dshfiles', title: 'dshfiles',
    })
    expect(folderSelection('/Users/me/dev')).toEqual({
      kind: 'directory', canonicalPath: '/Users/me/dev', title: 'dev',
    })
  })
})
