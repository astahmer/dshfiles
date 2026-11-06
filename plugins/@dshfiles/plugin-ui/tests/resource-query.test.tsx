import { createApiClient, resourceStore } from '@dshfiles/dshx/client'
import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginQueryProvider, QueryClient, resourceQueryOptions, useQuery } from '../src/query.js'

const boardApi = defineApi({
  id: 'board',
  version: 1,
  owner: '@acme/board',
  methods: { rows: method({ input: Schema.Struct({ scope: Schema.String }), output: Schema.Array(Schema.String), readOnly: true }) },
})

const connection = () => {
  const call = vi.fn(async (_channel: string, _endpoint: string, request: { readonly input?: unknown }) => ({
    ok: true,
    value: { version: 1, output: [JSON.stringify(request.input)] },
  }))
  const service = { rpc: { call } }
  return { call, context: { get: (name: string) => (name === 'connection' ? service : undefined) } }
}

afterEach(() => {
  cleanup()
  resourceStore().clear()
})

describe('resourceQueryOptions', () => {
  it('reads through the page-wide store, so two bundles share one in-flight read', async () => {
    const fixture = connection()
    const Reader = (props: { readonly bundle: string }): JSX.Element => {
      const client = createApiClient(fixture.context, boardApi, props.bundle)
      const rows = useQuery(resourceQueryOptions({ queryKey: ['board', props.bundle], client, method: 'rows', input: { scope: 'open' } }))
      return <span>{`${props.bundle}:${rows.data?.join(',') ?? 'loading'}`}</span>
    }
    render(
      <>
        <PluginQueryProvider client={new QueryClient()}>
          <Reader bundle="@acme/first" />
        </PluginQueryProvider>
        <PluginQueryProvider client={new QueryClient()}>
          <Reader bundle="@acme/second" />
        </PluginQueryProvider>
      </>,
    )
    await waitFor(() => expect(screen.getByText('@acme/second:{"scope":"open"}')).toBeTruthy())
    expect(screen.getByText('@acme/first:{"scope":"open"}')).toBeTruthy()
    expect(fixture.call).toHaveBeenCalledTimes(1)
  })
})
