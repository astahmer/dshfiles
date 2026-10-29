import type { HtmlPageTheme } from './html-page.js'

/**
 * Applied as the first element of the page's head. The iframe's `sandbox="allow-scripts"` (no same-origin) is the
 * isolation boundary; this policy adds "no network": every fetch, external script, stylesheet, font, frame and form
 * target is refused, and only inline code and data/blob images run.
 */
export const HTML_PAGE_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'"

/** Elements that could redirect the frame, rebase its URLs or loosen its policy. */
const STRIPPED_SELECTOR = 'base, meta[http-equiv]'

const themeTokenNames = ['bg', 'surface', 'fg', 'muted', 'border', 'accent', 'success', 'warning', 'danger', 'font', 'mono-font'] as const
type ThemeTokenName = (typeof themeTokenNames)[number]
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>
export type ColorScheme = 'light' | 'dark'

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

const fallbackTokens = {
  light: {
    bg: '#ffffff',
    surface: '#f5f6f8',
    fg: '#1f2329',
    muted: '#646a73',
    border: '#dee0e3',
    accent: '#3370ff',
    success: '#2ea121',
    warning: '#de7802',
    danger: '#e22e28',
    font: SANS,
    'mono-font': MONO,
  },
  dark: {
    bg: '#18191b',
    surface: '#232427',
    fg: '#ebebeb',
    muted: '#a6a6a6',
    border: '#3a3b3e',
    accent: '#4c88ff',
    success: '#51ba43',
    warning: '#f29d38',
    danger: '#f2615c',
    font: SANS,
    'mono-font': MONO,
  },
} satisfies Readonly<Record<ColorScheme, ThemeTokens>>

/** Host `--dsw-*` tokens each page variable reads, first match wins. */
const HOST_TOKEN_SOURCES = {
  bg: ['--dsw-alias-bg-base'],
  surface: ['--dsw-alias-bg-layer-1'],
  fg: ['--dsw-alias-label-primary'],
  muted: ['--dsw-alias-label-secondary'],
  border: ['--dsw-alias-border-l2'],
  accent: ['--dsw-alias-state-business-primary', '--dsw-alias-brand-primary'],
  success: ['--dsw-alias-state-success-primary'],
  warning: ['--dsw-alias-state-warn-primary'],
  danger: ['--dsw-alias-state-error-primary'],
  font: ['--dsw-font-family'],
  'mono-font': ['--dsw-font-family-mono'],
} satisfies Readonly<Record<ThemeTokenName, readonly string[]>>

/** A token value crosses into the page's stylesheet, so it may not close the declaration or the style element. */
const SAFE_TOKEN_VALUE = /^[^;{}<>\\]{1,200}$/

/** The DSH theme as page variables: `auto` reads the live Host tokens, a pinned theme uses its fixed palette. */
interface ThemeInput {
  readonly theme: HtmlPageTheme
  readonly hostScheme: ColorScheme
  readonly readHostToken: (name: string) => string
}

interface ResolvedTheme {
  readonly scheme: ColorScheme
  readonly tokens: ThemeTokens
}

const resolveThemeTokens = (input: ThemeInput): ResolvedTheme => {
  if (input.theme !== 'auto') return { scheme: input.theme, tokens: fallbackTokens[input.theme] }
  const fallback = fallbackTokens[input.hostScheme]
  const token = (name: ThemeTokenName): string =>
    HOST_TOKEN_SOURCES[name].map(source => input.readHostToken(source).trim()).find(value => SAFE_TOKEN_VALUE.test(value)) ?? fallback[name]
  return {
    scheme: input.hostScheme,
    tokens: {
      bg: token('bg'),
      surface: token('surface'),
      fg: token('fg'),
      muted: token('muted'),
      border: token('border'),
      accent: token('accent'),
      success: token('success'),
      warning: token('warning'),
      danger: token('danger'),
      font: token('font'),
      'mono-font': token('mono-font'),
    },
  }
}

const themeStylesheet = (scheme: ColorScheme, tokens: ThemeTokens): string =>
  [
    `:root{color-scheme:${scheme};${themeTokenNames.map(name => `--dsh-${name}:${tokens[name]};`).join('')}}`,
    ':where(html){background:var(--dsh-bg);color:var(--dsh-fg);font-family:var(--dsh-font);font-size:14px;line-height:1.5}',
    ':where(body){margin:12px}',
    ':where(code,pre,kbd,samp){font-family:var(--dsh-mono-font)}',
    ':where(a){color:var(--dsh-accent)}',
  ].join('\n')

/**
 * The page the sandboxed frame loads: the agent's markup re-serialized with the policy, charset and theme first in
 * its head. Parsing runs no script; any `<base>` or `http-equiv` meta the markup carried is dropped.
 */
const buildDocument = (input: { readonly html: string; readonly scheme: ColorScheme; readonly tokens: ThemeTokens }): string => {
  const page = new DOMParser().parseFromString(input.html, 'text/html')
  for (const element of Array.from(page.querySelectorAll(STRIPPED_SELECTOR))) element.remove()
  const policy = page.createElement('meta')
  policy.setAttribute('http-equiv', 'Content-Security-Policy')
  policy.setAttribute('content', HTML_PAGE_CSP)
  const charset = page.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  const theme = page.createElement('style')
  theme.setAttribute('data-dsh-theme', '')
  theme.textContent = themeStylesheet(input.scheme, input.tokens)
  page.head.prepend(policy, charset, theme)
  return `<!doctype html>\n${page.documentElement.outerHTML}`
}

const escapeAttribute = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')

/**
 * A standalone tab for "Open in new tab". A blob URL inherits the DSH origin, so the page never runs as that
 * document: the tab is a script-free shell whose only child is the same sandboxed frame the card uses.
 */
const buildStandalonePage = (input: { readonly title: string; readonly document: string; readonly scheme: ColorScheme; readonly background: string }): string =>
  [
    '<!doctype html>',
    `<html><head><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(HTML_PAGE_CSP)}"><meta charset="utf-8">`,
    `<title>${escapeText(input.title)}</title>`,
    `<style>html,body{margin:0;height:100%;color-scheme:${input.scheme};background:${input.background}}iframe{border:0;width:100%;height:100%;display:block}</style>`,
    `</head><body><iframe sandbox="allow-scripts" title="${escapeAttribute(input.title)}" srcdoc="${escapeAttribute(input.document)}"></iframe></body></html>`,
  ].join('')

export class SandboxedDocument {
  static readonly fallbackTokens = fallbackTokens
  static readonly resolveTheme = resolveThemeTokens
  static readonly build = buildDocument
  static readonly standalone = buildStandalonePage
}
