import { recordSpans } from '@dshfiles/dshx/tracing'
import { Response } from 'undici'
import { describe, expect, it } from 'vitest'
import { PublicNetwork, type FetchNetwork, type PinnedAddress } from '../src/network.js'
import { DEFAULT_FETCH_OPTIONS, ReadableFetchProvider, type FetchOptions } from '../src/provider.js'

/** A host table: each hostname resolves to fixed addresses and answers with a fixed response. */
interface Route {
  readonly addresses: readonly string[]
  readonly respond: (url: URL) => Response
}

const fakeNetwork = (routes: Record<string, Route>) => {
  const resolved: string[] = []
  const requested: string[] = []
  const network: FetchNetwork = {
    resolve: async hostname => {
      resolved.push(hostname)
      // The production validation, over the fake answer set; an IP literal never reaches the resolver.
      return PublicNetwork.resolvePublicAddresses(hostname, new AbortController().signal, async name => {
        const route = routes[name]
        if (route === undefined) throw new Error(`ENOTFOUND ${name}`)
        return route.addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))
      })
    },
    proxyFor: () => undefined,
    request: async (url: URL, addresses: readonly PinnedAddress[]) => {
      requested.push(`${url.toString()} via ${addresses.map(a => a.address).join(',')}`)
      const route = routes[url.hostname]
      if (route === undefined) throw new Error(`no route for ${url.hostname}`)
      return { response: route.respond(url), close: async () => undefined }
    },
    requestVia: async () => {
      throw new Error('no proxy in tests')
    },
  }
  return { network, resolved, requested }
}

const redirect = (location: string, status = 301): Response => new Response(null, { status, headers: { location } })
const html = (body: string): Response => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })

const provider = (network: FetchNetwork, options: Partial<FetchOptions> = {}) =>
  new ReadableFetchProvider(() => ({ ...DEFAULT_FETCH_OPTIONS, ...options }), network)

/** The rejection of a promise expected to fail, as an Error (a resolved value fails the test). */
const failure = (promise: Promise<unknown>): Promise<Error> =>
  promise.then(
    () => new Error('expected a rejection, the fetch resolved'),
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  )

const PUBLIC_A = '93.184.215.14'
const PUBLIC_B = '151.101.1.69'

const article = `<!doctype html><html><head><title>Guide</title></head><body>
  <nav><a href="/">Home</a> <a href="/docs">Docs</a> <a href="/blog">Blog</a></nav>
  <article><h1>Effect services</h1>
    ${'<p>A service is a value with an interface, provided once by a layer and read where it is needed, so tests can replace it whole. '.repeat(4)}<a href="/next">next page</a></p>
    ${'<p>Layers compose: a layer can depend on other services and is built once per scope, released when the scope closes. '.repeat(4)}</p>
  </article>
  <footer>Copyright footer text that should not survive extraction.</footer></body></html>`

describe('redirects', () => {
  it('follows a cross-origin redirect and resolves and pins every hop afresh', async () => {
    const { network, resolved, requested } = fakeNetwork({
      'example.com': { addresses: [PUBLIC_A], respond: () => redirect('https://docs.example.org/guide') },
      'docs.example.org': { addresses: [PUBLIC_B], respond: () => html('<html><body><p>moved here</p></body></html>') },
    })
    const result = await provider(network).fetch({ url: 'http://example.com/old' })
    expect(result.url).toBe('https://docs.example.org/guide')
    expect(result.statusCode).toBe(200)
    expect(resolved).toEqual(['example.com', 'docs.example.org'])
    expect(requested).toEqual([`http://example.com/old via ${PUBLIC_A}`, `https://docs.example.org/guide via ${PUBLIC_B}`])
  })

  it('refuses a redirect whose target resolves to a private address', async () => {
    const { network, requested } = fakeNetwork({
      'example.com': { addresses: [PUBLIC_A], respond: () => redirect('https://internal.example.net/admin', 302) },
      'internal.example.net': { addresses: ['10.0.0.5'], respond: () => html('secret') },
    })
    expect(await failure(provider(network).fetch({ url: 'https://example.com/' }))).toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(requested).toHaveLength(1)
  })

  it('refuses a redirect to a loopback literal, a non-HTTP scheme or embedded credentials', async () => {
    for (const location of ['http://127.0.0.1:3080/', 'file:///etc/passwd', 'https://user:pw@example.org/']) {
      const { network, requested } = fakeNetwork({ 'example.com': { addresses: [PUBLIC_A], respond: () => redirect(location) } })
      const error = await failure(provider(network).fetch({ url: 'https://example.com/' }))
      expect(error, location).toMatchObject({ code: expect.stringMatching(/^WEB_(BLOCKED|INVALID)_URL$/u) })
      expect(requested).toHaveLength(1)
    }
  })

  it('stops at the hop cap with a recovery hint', async () => {
    const { network } = fakeNetwork({ 'example.com': { addresses: [PUBLIC_A], respond: url => redirect(`/loop${url.pathname}`) } })
    expect(await failure(provider(network, { maxRedirects: 3 }).fetch({ url: 'https://example.com/' }))).toMatchObject({
      code: 'WEB_REDIRECT_BLOCKED',
      message: expect.stringContaining('maxRedirects'),
    })
  })
})

describe('content types', () => {
  const serve = (body: string | Uint8Array, contentType?: string) =>
    fakeNetwork({
      'example.com': {
        addresses: [PUBLIC_A],
        respond: () => new Response(body, { status: 200, headers: contentType === undefined ? {} : { 'content-type': contentType } }),
      },
    }).network

  it('decodes JavaScript, YAML and untyped UTF-8 text', async () => {
    for (const type of ['application/javascript', 'application/x-yaml', 'application/toml', 'application/octet-stream', undefined]) {
      const result = await provider(serve('key: value ✓\n', type)).fetch({ url: 'https://example.com/file' })
      expect(result.body, String(type)).toEqual({ kind: 'text', content: 'key: value ✓\n' })
    }
  })

  it('sniffs an untyped HTML document as HTML', async () => {
    const result = await provider(serve('<!DOCTYPE html><html><body><p>hi</p></body></html>', 'application/octet-stream'), { readable: false }).fetch({
      url: 'https://example.com/',
    })
    expect(result.body.kind).toBe('html')
  })

  it('refuses binary bodies and says how to get them', async () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01])
    for (const type of ['image/png', 'application/octet-stream']) {
      expect(await failure(provider(serve(binary, type)).fetch({ url: 'https://example.com/x' })), type).toMatchObject({
        code: 'WEB_UNSUPPORTED_CONTENT_TYPE',
        message: expect.stringContaining('curl -o'),
      })
    }
  })

  it('keeps a non-2xx response as a result', async () => {
    const { network } = fakeNetwork({
      'example.com': { addresses: [PUBLIC_A], respond: () => new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } }) },
    })
    expect(await provider(network).fetch({ url: 'https://example.com/' })).toMatchObject({ statusCode: 404, body: { kind: 'text', content: 'gone' } })
  })
})

describe('readable extraction', () => {
  const page = () => fakeNetwork({ 'example.com': { addresses: [PUBLIC_A], respond: () => html(article) } }).network

  it('returns the article without navigation or footer, with links made absolute', async () => {
    const result = await provider(page()).fetch({ url: 'https://example.com/guide' })
    expect(result.body.kind).toBe('html')
    expect(result.body.content).toContain('Effect services')
    expect(result.body.content).toContain('Layers compose')
    expect(result.body.content).not.toContain('Copyright footer')
    expect(result.body.content).not.toContain('>Blog<')
    expect(result.body.content).toContain('https://example.com/next')
  })

  it('returns the whole page when extraction is off', async () => {
    const result = await provider(page(), { readable: false }).fetch({ url: 'https://example.com/guide' })
    expect(result.body.content).toContain('Copyright footer')
  })

  it('keeps the whole page when there is no article', async () => {
    const { network } = fakeNetwork({ 'example.com': { addresses: [PUBLIC_A], respond: () => html('<html><body><p>tiny</p></body></html>') } })
    expect((await provider(network).fetch({ url: 'https://example.com/' })).body.content).toContain('<p>tiny</p>')
  })
})

describe('telemetry', () => {
  it('records a web fetch span with hop counts and the extraction outcome, never the URL or body', async () => {
    using recorder = recordSpans()
    const { network } = fakeNetwork({
      'example.com': { addresses: [PUBLIC_A], respond: () => redirect('https://docs.example.org/private-path') },
      'docs.example.org': { addresses: [PUBLIC_B], respond: () => html(article) },
    })
    await provider(network).fetch({ url: 'https://example.com/private-path' })
    const span = recorder.span('web fetch')
    expect(span.attributes).toEqual({
      'dshx.web-fetch-readable.status': 200,
      'dshx.web-fetch-readable.kind': 'html',
      'dshx.web-fetch-readable.truncated': false,
      'dshx.web-fetch-readable.redirects': 1,
      'dshx.web-fetch-readable.cross_origin_redirects': 1,
      'dshx.web-fetch-readable.extraction': 'article',
    })
    expect(JSON.stringify(span.attributes)).not.toMatch(/private-path|example/u)
  })
})

describe('cancellation', () => {
  it('reports a caller abort as WEB_ABORTED', async () => {
    const controller = new AbortController()
    controller.abort()
    const { network } = fakeNetwork({})
    expect(await failure(provider(network).fetch({ url: 'https://example.com/' }, controller.signal))).toMatchObject({ code: 'WEB_ABORTED' })
  })
})

describe('public address validation', () => {
  const resolveTo = (addresses: readonly string[]) => () => Promise.resolve(addresses.map(address => ({ address, family: address.includes(':') ? 6 : 4 })))

  it('accepts public addresses and refuses private, loopback and link-local ones', async () => {
    const signal = new AbortController().signal
    expect(await PublicNetwork.resolvePublicAddresses('example.com', signal, resolveTo([PUBLIC_A]))).toEqual([{ address: PUBLIC_A, family: 4 }])
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1']) {
      expect(await failure(PublicNetwork.resolvePublicAddresses('example.com', signal, resolveTo([PUBLIC_A, address]))), address).toMatchObject({
        code: 'WEB_BLOCKED_URL',
      })
    }
  })
})
