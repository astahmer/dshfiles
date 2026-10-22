import { describe, expect, it } from 'vitest'
import { fetchDshReleaseStatus, releaseStatusFromGitHub } from './release-status.js'

const githubRelease = (input: { readonly tag: string; readonly body?: string; readonly draft?: boolean }) => ({
  tag_name: input.tag,
  name: null,
  published_at: '2026-10-17T08:16:33Z',
  draft: input.draft ?? false,
  body: input.body ?? null,
  html_url: 'ignored external field',
})

describe('DSH GitHub release status', () => {
  it('lists releases after the installed version and keeps their links on GitHub', () => {
    const status = releaseStatusFromGitHub({
      currentVersion: '0.2.1-rc.1',
      response: [githubRelease({ tag: 'dsh-v0.2.1-rc.2' }), githubRelease({ tag: 'dsh-v0.2.1-rc.1' })],
    })

    expect(status.available).toBe(true)
    expect(status.comparisonKnown).toBe(true)
    expect(status.releases.map(release => release.version)).toEqual(['0.2.1-rc.2'])
    expect(status.latestUrl).toBe('https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2')
  })

  it('does not claim an update when the installed tag is missing or current', () => {
    const releases = [githubRelease({ tag: 'dsh-v0.2.1-rc.2' }), githubRelease({ tag: 'dsh-v0.2.1-rc.1' })]
    expect(releaseStatusFromGitHub({ currentVersion: '0.2.1-rc.2', response: releases })).toMatchObject({ available: false, comparisonKnown: true })
    expect(releaseStatusFromGitHub({ currentVersion: '0.2.1-custom', response: releases })).toMatchObject({ available: false, comparisonKnown: false })
  })

  it('extracts bounded English release highlights without exposing HTML', () => {
    const status = releaseStatusFromGitHub({
      currentVersion: '0.2.1-rc.1',
      response: [
        githubRelease({
          tag: 'dsh-v0.2.1-rc.2',
          body: '<h3 id="cn-release">新增功能</h3>\n- 忽略中文\n<h3 id="en-release">New Features</h3>\n- Add **plugin updates** with `hot reload`. by @contributor',
        }),
        githubRelease({ tag: 'dsh-v0.2.1-rc.1' }),
      ],
    })

    expect(status.releases[0]?.highlights).toEqual([{ section: 'New Features', text: 'Add plugin updates with hot reload.' }])
  })

  it('uses a fixed GitHub endpoint, rejects redirects and bounds the response', async () => {
    const called: RequestInit[] = []
    const fetcher: typeof fetch = async (_input, init) => {
      called.push(init ?? {})
      return new Response(JSON.stringify([githubRelease({ tag: 'dsh-v0.2.1-rc.2' })]), { status: 200 })
    }
    const status = await fetchDshReleaseStatus({ currentVersion: '0.2.1-rc.2', fetch: fetcher, signal: new AbortController().signal })

    expect(status.latestVersion).toBe('0.2.1-rc.2')
    expect(called[0]?.redirect).toBe('error')
    expect(called[0]?.headers).toMatchObject({ accept: 'application/vnd.github+json' })
  })

  it('rejects malformed release payloads', () => {
    expect(() => releaseStatusFromGitHub({ currentVersion: '0.2.1', response: [{ tag_name: 'not valid' }] })).toThrow()
  })
})
