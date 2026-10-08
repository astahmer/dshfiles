import Schema from '@deepseek-ai/schemastery'
import { defineSettings } from '@dshfiles/dshx/settings'

export const DEFAULT_HUB_BASE_URL = 'https://dshx.io'

const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'

export const validateHubBaseUrl = (value: string): URL => {
  const url = new URL(value)
  if (url.username !== '' || url.password !== '') throw new Error('Framework Hub URL must not contain credentials.')
  if (url.search !== '' || url.hash !== '') throw new Error('Framework Hub URL must not contain a query or fragment.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error('Framework Hub URL must use HTTPS; loopback HTTP is allowed for development.')
  }
  return url
}

export const normalizeHubBaseUrl = (value: string): string => {
  const url = validateHubBaseUrl(value)
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.href.replace(/\/$/, '')
}

export const marketplaceSettings = defineSettings({
  namespace: 'dshx-plugin-marketplace',
  schema: Schema.object({
    hubBaseUrl: Schema.string()
      .default(DEFAULT_HUB_BASE_URL)
      .description('Framework Hub serving the catalog. HTTPS only; loopback HTTP is accepted for local development.'),
    defaultSort: Schema.union(['latest', 'stars']).default('latest').description('Order the catalog opens with.'),
    hideIncompatible: Schema.boolean().default(false).description('Hide plugins whose DSH range excludes the running DSH version.'),
  }),
  applies: 'live',
})
