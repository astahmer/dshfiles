import { describe, expect, it } from 'vitest'
import { isThreadWorkspacePath, registeredProjects } from './registered-projects.js'
import type { ProjectConfig } from './project-config.js'
import { projectCheckSnippet, projectSettingRows } from './project-settings.js'

const declared: ProjectConfig = {
  iconPath: 'assets/icon.svg',
  defaultThreadWorkspace: 'isolated',
  bookmark: 'main',
  checks: ['test', 'typecheck'],
  scripts: [{ name: 'Install', command: 'pnpm install' }],
}

const tierOf = (config: ProjectConfig | null): Readonly<Record<string, string>> =>
  Object.fromEntries(projectSettingRows(config).map(row => [row.key, row.tier]))

describe('project setting tiers', () => {
  it('the repository file wins every key it declares', () => {
    const rows = projectSettingRows(declared)
    expect(rows.map(row => row.key)).toEqual(['iconPath', 'defaultThreadWorkspace', 'bookmark', 'checks', 'scripts'])
    expect(rows.every(row => row.tier === 'file' && row.tierLabel === 'dsh.project.json')).toBe(true)
    expect(rows.map(row => row.declared)).toEqual(['assets/icon.svg', 'isolated', 'main', 'test, typecheck', 'Install'])
  })

  it('falls back to the profile for the keys the profile owns and to built-in defaults otherwise', () => {
    const tiers = tierOf({})
    expect(tiers.defaultThreadWorkspace).toBe('profile')
    expect(tiers.bookmark).toBe('profile')
    expect(tiers.iconPath).toBe('built-in')
    expect(tiers.checks).toBe('built-in')
    expect(tiers.scripts).toBe('built-in')
  })

  it('reports the same fallbacks when the file is missing or invalid', () => {
    expect(projectSettingRows(null)).toEqual(projectSettingRows({}))
    expect(projectSettingRows(null).map(row => row.fallback)).toEqual([
      'Auto-detected icon, else a monogram',
      'The profile setting',
      'Origin’s default branch, else the global Bookmark setting',
      'No checks offered',
      'No scripts suggested',
    ])
  })

  it('says that a per-project main branch in the profile wins over the declared bookmark, and nothing else', () => {
    const overridden = projectSettingRows(declared).filter(row => row.overriddenBy !== null)
    expect(overridden.map(row => row.key)).toEqual(['bookmark'])
    expect(overridden[0]?.overriddenBy).toContain('wins over this file')
  })

  it('does not count an empty checks or scripts list as a declaration', () => {
    const tiers = tierOf({ checks: [], scripts: [] })
    expect(tiers.checks).toBe('built-in')
    expect(tiers.scripts).toBe('built-in')
  })
})

describe('project-checks YAML snippet', () => {
  it('builds the trusted profile entry from a command line, keeping quoted arguments whole', () => {
    const snippet = projectCheckSnippet({
      root: '/tmp/repo',
      script: { name: 'Install', command: "sh -c 'pnpm install --frozen-lockfile'", hint: 'Run after cloning' },
    })
    expect(snippet.problem).toBeNull()
    expect(snippet.yaml).toBe(
      [
        '  - id: "install"',
        '    label: "Install"',
        '    description: "Run after cloning"',
        '    command: "sh"',
        '    args: ["-c", "pnpm install --frozen-lockfile"]',
        '    root: "/tmp/repo"',
        '',
      ].join('\n'),
    )
  })

  it('omits the description when the script has no hint and keeps an empty args list', () => {
    const snippet = projectCheckSnippet({ root: '/Users/me/repo', script: { name: 'Check', command: 'pnpm typecheck' } })
    expect(snippet.yaml).toBe(
      ['  - id: "check"', '    label: "Check"', '    command: "pnpm"', '    args: ["typecheck"]', '    root: "/Users/me/repo"', ''].join('\n'),
    )
    expect(projectCheckSnippet({ root: '/repo', script: { name: 'Shell', command: 'bash' } }).yaml).toContain('    args: []\n')
  })

  it('slugs the action id into the project-checks pattern', () => {
    const idOf = (name: string) => projectCheckSnippet({ root: '/repo', script: { name, command: 'true' } }).yaml.split('\n')[0]
    expect(idOf('Run the tests!')).toBe('  - id: "run-the-tests"')
    expect(idOf('** weird name **')).toBe('  - id: "weird-name"')
    expect(idOf('!!!')).toBe('  - id: "script"')
    expect(idOf('A'.repeat(40))).toBe(`  - id: "${'a'.repeat(32)}"`)
  })

  it('refuses a command line it cannot split into argv, naming the fix', () => {
    const snippet = projectCheckSnippet({ root: '/repo', script: { name: 'Broken', command: 'pnpm "install' } })
    expect(snippet.yaml).toBe('')
    expect(snippet.problem).toMatch(/unclosed quote/u)
    expect(projectCheckSnippet({ root: '/repo', script: { name: 'Blank', command: '   ' } }).problem).toMatch(/command line is empty/u)
  })
})

describe('registered project list', () => {
  it('leaves jj thread workspaces out of the project list', () => {
    const workspaces = [
      { workspaceId: 'project', title: 'dshfiles', path: '/Users/me/dev/dshfiles' },
      { workspaceId: 'thread', title: 'thread', path: '/Users/me/dev/dshfiles-threads/thread-7ce777' },
      { workspaceId: 'old-thread', title: 'old', path: '/Users/me/dev/dshfiles-threads/thread-4c91b5/' },
      { workspaceId: 'hash-thread', title: 'older', path: '/Users/me/dev/dshfiles-threads/dshfiles-94a9c92d' },
    ]
    expect(registeredProjects(workspaces).map(workspace => workspace.workspaceId)).toEqual(['project'])
    expect(isThreadWorkspacePath('/Users/me/dev/dshfiles')).toBe(false)
    expect(isThreadWorkspacePath('/Users/me/dev/dshfiles-threads/thread-7ce777')).toBe(true)
    expect(isThreadWorkspacePath('/Users/me/dev/dshfiles-threads/dshfiles-94a9c92d')).toBe(true)
  })
})
