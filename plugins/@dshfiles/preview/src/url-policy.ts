export type UrlVerdict = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string }

const WEB_PROTOCOLS = new Set(['http:', 'https:'])

const bareHost = (hostname: string): string => hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase()

const hostMatches = (host: string, pattern: string): boolean => {
  const normalized = bareHost(pattern.trim())
  if (normalized.startsWith('*.')) return host.endsWith(normalized.slice(1))
  return host === normalized
}

/** Decides whether the preview browser may load a top-level URL; a bare `host:port` reads as http. */
export const checkPreviewUrl = (input: { readonly url: string; readonly allowedHosts: readonly string[]; readonly allowAnyHost: boolean }): UrlVerdict => {
  const raw = input.url.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || raw === 'about:blank' ? raw : `http://${raw}`
  if (candidate === 'about:blank') return { ok: true, url: candidate }
  if (!URL.canParse(candidate)) return { ok: false, reason: `"${raw}" is not a URL. Pass an http(s) address such as http://localhost:5173.` }
  const parsed = new URL(candidate)
  if (!WEB_PROTOCOLS.has(parsed.protocol)) return { ok: false, reason: `Only http and https pages can be previewed, not ${parsed.protocol}` }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'Preview URLs cannot carry credentials.' }
  const host = bareHost(parsed.hostname)
  if (input.allowAnyHost || input.allowedHosts.some(pattern => hostMatches(host, pattern))) return { ok: true, url: parsed.href }
  return {
    ok: false,
    reason: `${host} is not an allowed preview host (${input.allowedHosts.join(', ')}). Add it under Settings › dshfiles-preview › allowedHosts, or turn on allowAnyHost.`,
  }
}
