import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PluginQueryProvider, QueryClient, errorMessage, pluginQueryClient, useQuery } from '../src/query.js'

afterEach(cleanup)

describe('pluginQueryClient', () => {
  it('is one client per bundle', () => {
    expect(pluginQueryClient()).toBe(pluginQueryClient())
  })

  it('serves queries to children', async () => {
    const Reader = (): JSX.Element => {
      const query = useQuery({ queryKey: ['greeting'], queryFn: async () => 'hello' })
      return <span>{query.data ?? 'loading'}</span>
    }
    render(
      <PluginQueryProvider client={new QueryClient()}>
        <Reader />
      </PluginQueryProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello')).toBeTruthy())
  })
})

describe('errorMessage', () => {
  it('prefers an Error message and falls back otherwise', () => {
    expect(errorMessage(new Error('boom'), 'Failed')).toBe('boom')
    expect(errorMessage('boom', 'Failed')).toBe('Failed')
  })
})
