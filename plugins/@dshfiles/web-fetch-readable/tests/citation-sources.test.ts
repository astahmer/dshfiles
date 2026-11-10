import { describe, expect, it } from 'vitest'
import { CitationSources } from '../src/citation-sources.js'

describe('CitationSources', () => {
  it('reads web_search sources in order, keeps titles, drops non-web URLs and repeats', () => {
    const meta = {
      truncated: false,
      sources: [
        { url: 'https://www.example.com/a', title: ' Example A ', snippet: 'first' },
        { url: 'https://docs.example.org/b' },
        { url: 'https://www.example.com/a', title: 'Again' },
        { url: 'javascript:alert(1)', title: 'Nope' },
        { url: 'not a url' },
      ],
    }
    expect(CitationSources.fromSearch(meta)).toEqual([
      { url: 'https://www.example.com/a', host: 'example.com', title: 'Example A' },
      { url: 'https://docs.example.org/b', host: 'docs.example.org', title: undefined },
    ])
  })

  it('returns nothing for missing or malformed search meta', () => {
    expect(CitationSources.fromSearch(undefined)).toEqual([])
    expect(CitationSources.fromSearch({ sources: 'x' })).toEqual([])
  })

  it('titles a web_fetch page by its article heading and names the final URL', () => {
    const text = 'Fetched https://example.com/post (HTTP 200)\n\nExternal web content follows.\n\n# The readable title\n\nBody'
    expect(CitationSources.fromFetch({ meta: { url: 'https://example.com/post', statusCode: 200, truncated: false }, text })).toEqual([
      { url: 'https://example.com/post', host: 'example.com', title: 'The readable title' },
    ])
    expect(CitationSources.fromFetch({ meta: { url: 'https://example.com/raw' }, text: 'plain text' })).toEqual([
      { url: 'https://example.com/raw', host: 'example.com', title: undefined },
    ])
    expect(CitationSources.fromFetch({ meta: null, text })).toEqual([])
  })

  it('answers only a settled, successful web call, and no other tool', () => {
    const search = { sources: [{ url: 'https://example.com/a', title: 'A' }] }
    const fetch = { url: 'https://example.com/post' }
    expect(CitationSources.citationSourcesOf({ toolName: 'web_search', phase: 'result', isError: false, meta: search, text: undefined })).toEqual([
      { url: 'https://example.com/a', host: 'example.com', title: 'A' },
    ])
    expect(
      CitationSources.citationSourcesOf({ toolName: 'web_fetch', phase: 'result', isError: false, meta: fetch, text: '\n# The page\n' }),
    ).toEqual([{ url: 'https://example.com/post', host: 'example.com', title: 'The page' }])
    expect(CitationSources.citationSourcesOf({ toolName: 'web_search', phase: 'start', isError: false, meta: search, text: undefined })).toEqual([])
    expect(CitationSources.citationSourcesOf({ toolName: 'web_search', phase: 'result', isError: true, meta: search, text: undefined })).toEqual([])
    expect(CitationSources.citationSourcesOf({ toolName: 'bash', phase: 'result', isError: false, meta: search, text: undefined })).toEqual([])
  })
})
