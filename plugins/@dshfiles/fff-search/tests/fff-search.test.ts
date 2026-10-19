import { FileFinder } from '@ff-labs/fff-node'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FffSearch } from '../src/fff-search.js'

let workspace: string
let state: string
let finder: FileFinder

const write = (relativePath: string, content: string): void => {
  mkdirSync(join(workspace, relativePath, '..'), { recursive: true })
  writeFileSync(join(workspace, relativePath), content)
}

const isFile = (path: string): boolean => /\.\w+$/.test(path)

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'fff-search-workspace-'))
  state = mkdtempSync(join(tmpdir(), 'fff-search-state-'))
  write('.gitignore', 'dist/\n')
  write('src/rules.ts', 'export class LifecycleRules {}\nconst glob = "*.yml"\n')
  write('src/rules.test.ts', 'LifecycleRules.check()\n')
  write('src/nested/use.tsx', 'LifecycleRules.apply()\n')
  write('dist/rules.js', 'LifecycleRules.compiled()\n')
  write('config/app.yml', 'name: app\n')
  write('docs/notes.md', 'see src/rules for lifecyclerules\n')
  write('many.txt', Array.from({ length: 300 }, (_, index) => `needle ${index}`).join('\n'))
  const created = FileFinder.create({ basePath: workspace, frecencyDbPath: join(state, 'frecency.db'), historyDbPath: join(state, 'history.db') })
  if (!created.ok) throw new Error(created.error)
  finder = created.value
  await finder.waitForIndexReady(30_000)
})

afterAll(() => {
  finder.destroy()
  rmSync(workspace, { recursive: true, force: true })
  rmSync(state, { recursive: true, force: true })
})

const grep = (pattern: string, options: { path?: string; include?: string } = {}) =>
  FffSearch.grep({
    finder,
    scope: FffSearch.scope({ workingDirectory: workspace, path: options.path, isFile }),
    pattern,
    include: options.include,
    workingDirectory: workspace,
  })

describe('FffSearch.grep', () => {
  it('finds every non-ignored match with workspace-relative paths', () => {
    const outcome = grep('LifecycleRules')
    expect(outcome.matches.map(match => `${match.path}:${match.lineNumber}`).sort()).toEqual(['src/nested/use.tsx:1', 'src/rules.test.ts:1', 'src/rules.ts:1'])
  })

  it('narrows to a directory, an include glob and a single file', () => {
    expect(grep('LifecycleRules', { path: 'src/nested' }).matches.map(match => match.path)).toEqual(['src/nested/use.tsx'])
    expect(grep('LifecycleRules', { include: '*.tsx' }).matches.map(match => match.path)).toEqual(['src/nested/use.tsx'])
    expect(grep('LifecycleRules', { path: 'src/rules.ts' }).matches.map(match => match.path)).toEqual(['src/rules.ts'])
  })

  it('reads a pattern that looks like an fff constraint as a regular expression', () => {
    expect(grep('\\*\\.yml').matches.map(match => match.path)).toEqual(['src/rules.ts'])
  })

  it('matches case-sensitively, like ripgrep', () => {
    expect(grep('lifecyclerules').matches.map(match => match.path)).toEqual(['docs/notes.md'])
  })

  it('searches a path-shaped literal as text, not as a directory constraint', () => {
    expect(grep('src/rules').matches.map(match => match.path)).toEqual(['docs/notes.md'])
  })

  it('caps shown matches but reports the total', () => {
    const outcome = grep('needle \\d+')
    expect(outcome.matches).toHaveLength(FffSearch.maxGrepMatches)
    expect(outcome.total).toBe(300)
    expect(FffSearch.renderGrep(outcome)).toMatch(/^Found 250 of 300 matches/)
  })

  it('rejects an invalid regular expression instead of searching for it literally', () => {
    expect(() => grep('foo(bar')).toThrow(/not a valid regular expression/)
  })
})

describe('FffSearch.glob', () => {
  it('matches basenames at any depth and anchors to a directory', () => {
    const glob = (pattern: string, path?: string) =>
      FffSearch.glob({ finder, scope: FffSearch.scope({ workingDirectory: workspace, path, isFile: () => false }), pattern, workingDirectory: workspace })
    expect(glob('*.yml').paths).toEqual(['config/app.yml'])
    expect(glob('*.ts', 'src').paths.sort()).toEqual(['src/rules.test.ts', 'src/rules.ts'])
  })
})
