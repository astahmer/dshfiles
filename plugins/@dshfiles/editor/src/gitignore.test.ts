import { describe, expect, it } from 'vitest'
import { isIgnored, parseGitignore } from './gitignore.js'

const check = (text: string, path: string, directory = false, base = '') => isIgnored({ rules: parseGitignore({ text, base }), path, directory })

describe('gitignore matching', () => {
  it('matches unanchored names at any depth and anchored paths from the file directory', () => {
    expect(check('dist', 'dist', true)).toBe(true)
    expect(check('dist', 'packages/a/dist', true)).toBe(true)
    expect(check('*.log', 'logs/debug.log')).toBe(true)
    expect(check('/dist', 'packages/dist', true)).toBe(false)
    expect(check('build/out', 'build/out', true)).toBe(true)
    expect(check('build/out', 'x/build/out', true)).toBe(false)
  })

  it('honours directory-only rules, negation order, comments and escapes', () => {
    expect(check('cache/', 'cache')).toBe(false)
    expect(check('cache/', 'cache', true)).toBe(true)
    expect(check('*.env\n!example.env', 'example.env')).toBe(false)
    expect(check('!example.env\n*.env', 'example.env')).toBe(true)
    expect(check('# note\n\\#hash', '#hash')).toBe(true)
    expect(check('# note', '# note')).toBe(false)
    expect(check('file?.[ch]', 'file1.c')).toBe(true)
    expect(check('file[!0-9].c', 'file1.c')).toBe(false)
  })

  it('expands ** as leading, trailing and middle segments', () => {
    expect(check('**/fixtures', 'a/b/fixtures', true)).toBe(true)
    expect(check('**/fixtures', 'fixtures', true)).toBe(true)
    expect(check('out/**', 'out/a/b.js')).toBe(true)
    expect(check('out/**', 'out', true)).toBe(false)
    expect(check('a/**/b', 'a/b', true)).toBe(true)
    expect(check('a/**/b', 'a/x/y/b', true)).toBe(true)
    expect(check('a/**/b', 'c/a/x/b', true)).toBe(false)
  })

  it('scopes a nested .gitignore to its own directory', () => {
    expect(check('*.snap', 'pkg/__snapshots__/a.snap', false, 'pkg')).toBe(true)
    expect(check('*.snap', 'other/a.snap', false, 'pkg')).toBe(false)
    expect(check('/local', 'pkg/local', true, 'pkg')).toBe(true)
    expect(check('/local', 'pkg/sub/local', true, 'pkg')).toBe(false)
  })
})
