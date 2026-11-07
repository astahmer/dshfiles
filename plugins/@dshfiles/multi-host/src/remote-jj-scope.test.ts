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
