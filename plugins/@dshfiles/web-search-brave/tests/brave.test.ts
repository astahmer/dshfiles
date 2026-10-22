import { describe, expect, it } from 'vitest'
import { BraveSearchModel } from '../src/brave.js'

const payload = {
  web: {
    results: [
      {
        title: 'Node <strong>docs</strong>',
        url: 'https://nodejs.org/api/',
        description: 'API <strong>reference</strong> &amp; guide',
        page_age: '2026-10-01T00:00:00Z',
      },
      { title: 'Node docs duplicate', url: 'https://nodejs.org/api/' },
      { title: 'Second', url: 'https://example.com/second', age: '2 days ago' },
    ],
  },
}

describe('stripMarkup', () => {
  it('removes tags, decodes entities and collapses whitespace', () => {
    expect(BraveSearchModel.stripMarkup('a <b>bold</b> &amp; <i>italic</i>\n text')).toBe('a bold & italic text')
    expect(BraveSearchModel.stripMarkup('it&#039;s &#x27;fine&#x27;')).toBe("it's 'fine'")
  })
})

describe('toSources', () => {
  it('maps results, strips markup and dedupes by URL', () => {
    const sources = BraveSearchModel.toSources(BraveSearchModel.parseResponse(JSON.stringify(payload)))
    expect(sources).toHaveLength(2)
    expect(sources[0]).toEqual({ url: 'https://nodejs.org/api/', title: 'Node docs', snippet: 'API reference & guide', publishedAt: '2026-10-01T00:00:00Z' })
    expect(sources[1]?.publishedAt).toBe('2 days ago')
  })

  it('refuses an unexpected shape instead of returning nothing', () => {
    expect(() => BraveSearchModel.parseResponse(JSON.stringify({ unexpected: true }))).toThrow(/unexpected response shape/u)
  })

  it('returns an empty list when Brave answers without results', () => {
    expect(BraveSearchModel.toSources(BraveSearchModel.parseResponse(JSON.stringify({ web: {} })))).toEqual([])
  })
})

describe('searchBrave', () => {
  const options = { apiKey: 'key-123', count: 5, safesearch: 'moderate' as const }

  it('calls the Brave endpoint with the key and maps the response', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, headers: new Headers(init?.headers) })
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    const result = await BraveSearchModel.search({ query: 'node api', maxResults: 2 }, { ...options, fetch: fakeFetch })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(false)
    expect(calls[0]?.url).toContain('api.search.brave.com/res/v1/web/search')
    expect(calls[0]?.url).toContain('q=node+api')
    expect(calls[0]?.headers.get('x-subscription-token')).toBe('key-123')
  })

  it('surfaces a rejected key with guidance', async () => {
    const fakeFetch: typeof fetch = async () => new Response('unauthorized', { status: 401 })
    await expect(BraveSearchModel.search({ query: 'x' }, { ...options, fetch: fakeFetch })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: expect.stringContaining('key was rejected'),
    })
  })

  it('fails when Brave returns no results', async () => {
    const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ web: { results: [] } }), { status: 200 })
    await expect(BraveSearchModel.search({ query: 'x' }, { ...options, fetch: fakeFetch })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('reports a caller abort as WEB_ABORTED', async () => {
    const controller = new AbortController()
    const fakeFetch: typeof fetch = async () => {
      controller.abort()
      throw new Error('aborted')
    }
    await expect(BraveSearchModel.search({ query: 'x' }, { ...options, fetch: fakeFetch }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
})
