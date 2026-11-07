import { describe, expect, test } from 'vitest'
import type { JsonValue } from './api.js'
import { RemoteJjScope } from './remote-jj-scope.js'

const refused = (action: JsonValue, folder: string | undefined = '/remote/project') => RemoteJjScope.refusal({ sessionId: 'session-a', folder, action })

describe('a JJ action on a mirrored thread', () => {
  test('reaches the thread folder, with or without naming the thread', () => {
    expect(refused({ path: '/remote/project' })).toBeUndefined()
    expect(refused({ path: '/remote/project', sessionId: 'session-a' })).toBeUndefined()
    expect(refused({ path: '/remote/project', force: false })).toBeUndefined()
  })

  test.each([
    ['another workspace', { path: '/remote/other' }],
    ['a subfolder', { path: '/remote/project/nested' }],
    ['another thread', { path: '/remote/project', sessionId: 'session-b' }],
    ['no path', { force: true }],
    ['something that is not an action', 'land'],
  ])('refuses %s', (_name, action) => {
    expect(refused(action)).toMatchObject({ ok: false, code: 'session/path-mismatch' })
  })

  test('refuses when the owner reported no folder', () => {
    expect(RemoteJjScope.refusal({ sessionId: 'session-a', folder: undefined, action: { path: '/remote/project' } })).toMatchObject({ ok: false })
  })
})

describe('a repository call on a mirrored thread', () => {
  const folder = '/remote/thread-a'
  const repoId = '11111111-1111-4111-8111-111111111111'
  const refused = (call: JsonValue) => RemoteJjScope.repositoryRefusal({ folder, repoIds: new Set([repoId]), call })

  test('reaches the thread folder and the repository it resolves to', () => {
    expect(refused({ path: folder })).toBeUndefined()
    expect(refused({ cwd: folder, base: 'main' })).toBeUndefined()
    expect(refused({ paths: [folder], references: [] })).toBeUndefined()
    expect(refused({ repoId, limit: 10 })).toBeUndefined()
    expect(refused({ repoId, action: { kind: 'workspace-add', parentPath: '/remote' } })).toBeUndefined()
  })

  test.each([
    ['another folder', { path: '/remote/other' }],
    ['another working directory', { cwd: '/etc', base: 'main' }],
    ['a list with another folder', { paths: [folder, '/remote/other'] }],
    ['another repository', { repoId: '22222222-2222-4222-8222-222222222222' }],
    ['a workspace placed elsewhere', { repoId, action: { kind: 'workspace-add', parentPath: '/tmp' } }],
    ['a call that names nothing', { limit: 10 }],
  ])('refuses %s', (_name, call) => {
    expect(refused(call)).toMatchObject({ ok: false, code: 'session/path-mismatch' })
  })

  test('refuses an id nothing issued for this thread', () => {
    expect(RemoteJjScope.repositoryRefusal({ folder, repoIds: new Set(), call: { repoId } })).toMatchObject({ ok: false })
  })
})
