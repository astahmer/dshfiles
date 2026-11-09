import { describe, expect, it } from 'vitest'
import { ProjectBookmarkRequest } from './project-bookmark-request.js'

/** The error shape dshx raises when a Host's schema refuses an input field (an older Host without `bookmark`). */
const contractRejection = Object.assign(new Error('Unexpected key "bookmark"'), { kind: 'contract' })

describe('project bookmark request', () => {
  it('sends a project main branch other than main, and nothing for main or a name the Host would refuse', async () => {
    const sent: (string | undefined)[] = []
    const read = async (bookmark: string | undefined) => {
      sent.push(bookmark)
      return bookmark ?? 'main'
    }
    expect(await ProjectBookmarkRequest.withProjectBookmark({ bookmark: 'develop', read })).toBe('develop')
    expect(await ProjectBookmarkRequest.withProjectBookmark({ bookmark: 'main', read })).toBe('main')
    expect(await ProjectBookmarkRequest.withProjectBookmark({ bookmark: undefined, read })).toBe('main')
    expect(await ProjectBookmarkRequest.withProjectBookmark({ bookmark: 'x") | all()', read })).toBe('main')
    expect(sent).toEqual(['develop', undefined, undefined, undefined])
  })

  it('asks again without the field when an older Host rejects it, and lets every other failure through', async () => {
    const sent: (string | undefined)[] = []
    const olderHost = async (bookmark: string | undefined) => {
      sent.push(bookmark)
      if (bookmark !== undefined) throw contractRejection
      return 'main landmarks'
    }
    expect(await ProjectBookmarkRequest.withProjectBookmark({ bookmark: 'develop', read: olderHost })).toBe('main landmarks')
    expect(sent).toEqual(['develop', undefined])
    const failing = () => Promise.reject(new Error('jj failed'))
    await expect(ProjectBookmarkRequest.withProjectBookmark({ bookmark: 'develop', read: failing })).rejects.toThrow('jj failed')
  })
})
