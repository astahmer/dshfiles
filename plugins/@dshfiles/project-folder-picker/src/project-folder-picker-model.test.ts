import { describe, expect, it } from 'vitest'
import { ProjectFolderPickerModel } from './project-folder-picker-model.js'
import type { RegisteredProject } from './project-folder-picker.js'

const dshfilesProject: RegisteredProject = { workspaceId: 'ws-1', title: 'dshfiles', canonicalPath: '/Users/me/dev/dshfiles' }
const projects: readonly RegisteredProject[] = [dshfilesProject, { workspaceId: 'ws-2', title: 'emisoup', canonicalPath: '/Users/me/dev/emisoup' }]

describe('project and folder selection', () => {
  it('preserves project mode by default and starts directory mode at Host home', () => {
    expect(ProjectFolderPickerModel.initialBrowseTarget(undefined)).toBeNull()
    expect(ProjectFolderPickerModel.initialBrowseTarget('projects')).toBeNull()
    expect(ProjectFolderPickerModel.initialBrowseTarget('directories')).toEqual({ path: undefined })
  })

  it('recognizes absolute and home-relative folder queries', () => {
    expect(ProjectFolderPickerModel.isPathQuery('/Users/me/dev')).toBe(true)
    expect(ProjectFolderPickerModel.isPathQuery('~/dev/')).toBe(true)
    expect(ProjectFolderPickerModel.isHomeRelativePathQuery(' ~ ')).toBe(true)
    expect(ProjectFolderPickerModel.isPathQuery('dev')).toBe(false)
    expect(ProjectFolderPickerModel.isPathQuery('~other/dev')).toBe(false)
  })

  it('resolves home-relative queries using the Host-reported home path', () => {
    expect(ProjectFolderPickerModel.resolvePathQuery('~/dev/', '/Users/me')).toBe('/Users/me/dev')
    expect(ProjectFolderPickerModel.resolvePathQuery('~', '/Users/me')).toBe('/Users/me')
    expect(ProjectFolderPickerModel.resolvePathQuery('~/dev', '/')).toBe('/dev')
    expect(ProjectFolderPickerModel.resolvePathQuery('/Users/me/dev', '/Other/home')).toBe('/Users/me/dev')
    expect(ProjectFolderPickerModel.resolvePathQuery('/Users/me/dev/', '/Other/home')).toBe('/Users/me/dev')
    expect(ProjectFolderPickerModel.resolvePathQuery('~/dev', undefined)).toBeNull()
    expect(ProjectFolderPickerModel.resolvePathQuery('dev', '/Users/me')).toBeNull()
  })

  it('browses one matching directory and keeps ambiguous or incomplete listings explicit', () => {
    const listing = {
      path: '/Users/me',
      home: '/Users/me',
      entries: [
        { name: 'dev', path: '/Users/me/dev' },
        { name: 'developer', path: '/Users/me/developer' },
        { name: 'docs', path: '/Users/me/docs' },
      ],
      truncated: false,
    }

    expect(ProjectFolderPickerModel.matchingDirectoryPaths(listing, '~/dev')).toEqual(['/Users/me/dev', '/Users/me/developer'])
    expect(ProjectFolderPickerModel.uniqueMatchingDirectoryPath(listing, '~/dev')).toBeNull()
    expect(ProjectFolderPickerModel.uniqueMatchingDirectoryPath(listing, '~/dev/')).toBe('/Users/me/dev')
    expect(ProjectFolderPickerModel.uniqueMatchingDirectoryPath(listing, '~/doc')).toBe('/Users/me/docs')
    expect(ProjectFolderPickerModel.uniqueMatchingDirectoryPath({ ...listing, truncated: true }, '~/doc')).toBeNull()
    expect(
      ProjectFolderPickerModel.uniqueMatchingDirectoryPath(
        { ...listing, path: '/Users/me/dev', entries: [{ name: 'repository', path: '/Users/me/dev/repository' }] },
        '~/dev/repository',
      ),
    ).toBe('/Users/me/dev/repository')
  })

  it('checks path ancestry on directory boundaries', () => {
    expect(ProjectFolderPickerModel.isPathAtOrWithin('/Users/me/dev', '/Users/me')).toBe(true)
    expect(ProjectFolderPickerModel.isPathAtOrWithin('/Users/me', '/Users/me')).toBe(true)
    expect(ProjectFolderPickerModel.isPathAtOrWithin('/Users/meteor', '/Users/me')).toBe(false)
  })

  it('searches registered project names and canonical paths', () => {
    expect(ProjectFolderPickerModel.filterRegisteredProjects(projects, 'EMI')).toEqual([projects[1]])
    expect(ProjectFolderPickerModel.filterRegisteredProjects(projects, '/Users/me/dev/dsh')).toEqual([])
    expect(ProjectFolderPickerModel.filterRegisteredProjects(projects, '~/dev/dsh')).toEqual([])
  })

  it('wraps keyboard selection and handles an empty list', () => {
    expect(ProjectFolderPickerModel.movePickerSelection(1, 2, 'down')).toBe(0)
    expect(ProjectFolderPickerModel.movePickerSelection(0, 2, 'up')).toBe(1)
    expect(ProjectFolderPickerModel.movePickerSelection(4, 0, 'down')).toBe(0)
  })

  it('keeps project identity and canonical folder path explicit', () => {
    expect(ProjectFolderPickerModel.workspaceSelection(dshfilesProject)).toEqual({
      kind: 'workspace',
      workspaceId: 'ws-1',
      canonicalPath: '/Users/me/dev/dshfiles',
      title: 'dshfiles',
    })
    expect(ProjectFolderPickerModel.folderSelection('/Users/me/dev')).toEqual({
      kind: 'directory',
      canonicalPath: '/Users/me/dev',
      title: 'dev',
    })
  })

  it('lists matching projects on the Projects tab and unregistered recent folders on the Recents tab', () => {
    const recentFolders = ['/Users/me/dev/dshfiles', '/Users/me/dev/bb-plugins', '/Users/me/dev/bb-plugins']
    const entriesOn = (tab: 'projects' | 'recents', query: string) =>
      ProjectFolderPickerModel.pickerEntries({ projects, recentFolders, query, tab, excludeJjWorkspaces: false })
    expect(entriesOn('projects', 'dev').map(entry => (entry.kind === 'project' ? entry.project.title : entry.path))).toEqual(['dshfiles', 'emisoup'])
    expect(entriesOn('recents', 'dev').map(entry => (entry.kind === 'project' ? entry.project.title : entry.path))).toEqual(['/Users/me/dev/bb-plugins'])
    expect(entriesOn('recents', 'emi')).toEqual([])
    expect(entriesOn('projects', '/Users')).toEqual([])
    expect(entriesOn('recents', '~/dev')).toEqual([])
    const recent = entriesOn('recents', '')[0]
    expect(recent === undefined ? null : ProjectFolderPickerModel.pickerEntrySelection(recent)).toEqual({
      kind: 'directory',
      canonicalPath: '/Users/me/dev/bb-plugins',
      title: 'bb-plugins',
    })
  })

  it('hides JJ workspaces from the Projects tab only when excluded', () => {
    const threadWorkspace: RegisteredProject = {
      workspaceId: 'ws-3',
      title: 'dshfiles · thread-07ef22',
      canonicalPath: '/Users/me/dev/dshfiles-threads/thread-07ef22',
      isJjWorkspace: true,
    }
    const titlesWith = (excludeJjWorkspaces: boolean) =>
      ProjectFolderPickerModel.pickerEntries({
        projects: [...projects, threadWorkspace],
        recentFolders: [],
        query: 'dshfiles',
        tab: 'projects',
        excludeJjWorkspaces,
      }).map(entry => (entry.kind === 'project' ? entry.project.title : entry.path))
    expect(titlesWith(true)).toEqual(['dshfiles'])
    expect(titlesWith(false)).toEqual(['dshfiles', 'dshfiles · thread-07ef22'])
  })
})
