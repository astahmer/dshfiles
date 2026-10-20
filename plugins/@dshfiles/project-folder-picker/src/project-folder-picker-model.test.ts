import { describe, expect, it } from 'vitest'
import { ProjectFolderPickerModel, type PickerTab } from './project-folder-picker-model.js'
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

  const threadWorkspace: RegisteredProject = {
    workspaceId: 'ws-3',
    title: 'dshfiles · thread-07ef22',
    canonicalPath: '/Users/me/dev/dshfiles-threads/thread-07ef22',
    isJjWorkspace: true,
  }
  const allProjects = [...projects, threadWorkspace]
  const recentFolders = ['/Users/me/dev/emisoup', '/Users/me/dev/bb-plugins', '/Users/me/dev/bb-plugins']
  const sectionsOn = (tab: PickerTab, query: string) =>
    ProjectFolderPickerModel.pickerSections({ projects: allProjects, recentFolders, query, tab }).map(section => ({
      id: section.id,
      titles: section.entries.map(entry => (entry.kind === 'project' ? entry.project.title : entry.path)),
    }))

  it('keeps JJ thread workspaces off the Projects tab and lists them on their own tab', () => {
    expect(sectionsOn('projects', 'dshfiles')).toEqual([{ id: 'projects', titles: ['dshfiles'] }])
    expect(sectionsOn('workspaces', '')).toEqual([{ id: 'workspaces', titles: ['dshfiles · thread-07ef22'] }])
  })

  it('lists recent folders in order, showing a registered one as its project', () => {
    expect(sectionsOn('recents', '')).toEqual([{ id: 'recents', titles: ['emisoup', '/Users/me/dev/bb-plugins'] }])
    expect(sectionsOn('recents', 'bb')).toEqual([{ id: 'recents', titles: ['/Users/me/dev/bb-plugins'] }])
    const recent = ProjectFolderPickerModel.pickerSections({ projects: allProjects, recentFolders, query: 'bb', tab: 'recents' })[0]?.entries[0]
    expect(recent === undefined ? null : ProjectFolderPickerModel.pickerEntrySelection(recent)).toEqual({
      kind: 'directory',
      canonicalPath: '/Users/me/dev/bb-plugins',
      title: 'bb-plugins',
    })
  })

  it('lists recents, then projects, then workspaces on Everything, each folder once', () => {
    expect(sectionsOn('all', '')).toEqual([
      { id: 'recents', titles: ['emisoup', '/Users/me/dev/bb-plugins'] },
      { id: 'projects', titles: ['dshfiles'] },
      { id: 'workspaces', titles: ['dshfiles · thread-07ef22'] },
    ])
    expect(sectionsOn('all', 'thread')).toEqual([{ id: 'workspaces', titles: ['dshfiles · thread-07ef22'] }])
    expect(sectionsOn('all', '~/dev')).toEqual([])
  })

  it('never lists a JJ workspace as a recent and leads Everything and Projects with pinned projects', () => {
    const sections = ProjectFolderPickerModel.pickerSections({
      projects: allProjects,
      recentFolders: [threadWorkspace.canonicalPath, '/Users/me/dev/emisoup'],
      pinnedWorkspaceIds: ['ws-1'],
      query: '',
      tab: 'all',
    }).map(section => ({ id: section.id, titles: section.entries.map(entry => (entry.kind === 'project' ? entry.project.title : entry.path)) }))
    expect(sections).toEqual([
      { id: 'pinned', titles: ['dshfiles'] },
      { id: 'recents', titles: ['emisoup'] },
      { id: 'workspaces', titles: ['dshfiles · thread-07ef22'] },
    ])
    expect(
      ProjectFolderPickerModel.pickerSections({ projects: allProjects, recentFolders: [], pinnedWorkspaceIds: ['ws-2'], query: '', tab: 'projects' }).map(
        section => section.id,
      ),
    ).toEqual(['pinned', 'projects'])
    expect(ProjectFolderPickerModel.availableTabs({ projects: allProjects, recentFolders: [threadWorkspace.canonicalPath] })).not.toContain('recents')
  })

  it('offers Recents and Workspaces tabs only when they have folders', () => {
    expect(ProjectFolderPickerModel.availableTabs({ projects, recentFolders: [] })).toEqual(['all', 'projects'])
    expect(ProjectFolderPickerModel.availableTabs({ projects: allProjects, recentFolders })).toEqual(['all', 'projects', 'recents', 'workspaces'])
  })
})
