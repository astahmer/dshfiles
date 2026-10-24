import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/**
 * One HTTP request to an account provider, in an `ai-accounts provider request` span carrying the provider, the
 * operation, the server host and the response status; never the URL path, headers, credentials or body.
 */
export const providerFetch = (input: {
  readonly provider: string
  readonly operation: 'usage' | 'catalog' | 'credits'
  readonly url: string
  readonly init: RequestInit
  readonly fetch?: typeof fetch | undefined
}): Promise<Response> =>
  withSpan(
    'ai-accounts provider request',
    {
      kind: 'client',
      attributes: {
        ...pluginAttributes({ plugin: 'ai-accounts', attributes: { provider: input.provider, operation: input.operation } }),
        'server.address': hostOf(input.url),
      },
    },
    async span => {
      const response = await (input.fetch ?? fetch)(input.url, input.init)
      span.setAttribute('http.response.status_code', response.status)
      return response
    },
  )
