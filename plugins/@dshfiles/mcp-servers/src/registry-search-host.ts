import { withSpan } from '@dshfiles/dshx/tracing'
import { McpCatalogModel, type RegistrySearchFetcher, type RegistrySearchService } from './catalog.js'

/** Host-only: one `mcp registry search` span per search with the registry host, status and result count, never the query. */
export const createTracedRegistrySearch = (input: { readonly fetch: RegistrySearchFetcher }): RegistrySearchService => ({
  search: request =>
    withSpan('mcp registry search', { kind: 'client' }, async span => {
      const service = McpCatalogModel.createRegistrySearchService({
        fetch: async (url, init) => {
          span.setAttribute('server.address', url.host)
          const response = await input.fetch(url, init)
          span.setAttribute('http.response.status_code', response.status)
          return response
        },
      })
      const servers = await service.search(request)
      span.setAttribute('dshx.mcp-servers.results', servers.length)
      return servers
    }),
})
