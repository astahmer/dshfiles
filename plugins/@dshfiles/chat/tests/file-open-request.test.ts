import { describe, expect, it } from 'vitest'
import { FileOpenRequestModel } from '../src/file-open-request.js'

const opened = (path = 'a.ts') => {
  const state = FileOpenRequestModel.beginFileOpen({ path, options: { line: 3 } })
  if (state.status !== 'opening') throw new Error('a fresh open is opening')
  return state
}

describe('file open request', () => {
  it('shows the busy state until the Host answers', () => {
    const state = opened()
    expect(state).toMatchObject({ status: 'opening', path: 'a.ts', options: { line: 3 }, refusal: undefined })
    expect(FileOpenRequestModel.settleFileOpen(state, { request: state.request, message: undefined })).toEqual({ status: 'idle' })
  })

  it('keeps a refusal on screen', () => {
    const state = opened()
    expect(FileOpenRequestModel.settleFileOpen(state, { request: state.request, message: 'no such file' })).toEqual({
      status: 'refused',
      path: 'a.ts',
      message: 'no such file',
    })
  })

  it('ignores a settlement from a gesture another one replaced', () => {
    const first = opened('a.ts')
    const second = opened('b.ts')
    expect(FileOpenRequestModel.settleFileOpen(second, { request: first.request, message: 'no such file' })).toBe(second)
    expect(FileOpenRequestModel.settleFileOpen(second, { request: second.request, message: 'still missing' })).toMatchObject({
      status: 'refused',
      path: 'b.ts',
    })
  })

  it('keeps the refusal visible while a retry runs', () => {
    const retry = FileOpenRequestModel.beginFileOpen({ path: 'a.ts', options: undefined, refusal: 'no such file' })
    expect(retry).toMatchObject({ status: 'opening', path: 'a.ts', refusal: 'no such file' })
  })

  it('ignores the settlement of an open the dialog already closed', () => {
    const closed = FileOpenRequestModel.idleFileOpen()
    const state = opened()
    expect(FileOpenRequestModel.settleFileOpen(closed, { request: state.request, message: 'no such file' })).toBe(closed)
  })
})
