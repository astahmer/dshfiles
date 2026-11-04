/**
 * The share page and the static export: one self-contained HTML document with inline CSS, no script, no external
 * resource and no link back into DSH. Every transcript character is HTML-escaped before the few markup rules
 * (fenced code, inline code, paragraphs) are applied, so a message can never inject markup.
 */

export interface PageEntry {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

export interface PageContent {
  readonly title: string
  readonly entries: readonly PageEntry[]
  /** Live pages say when they were read and reload themselves; snapshots say when they were frozen. */
  readonly mode: 'live' | 'snapshot' | 'export'
  readonly capturedAt: number
  readonly expiresAt: number | null
  /** The Host returned only the latest messages. */
  readonly truncated: boolean
}

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const inline = (escaped: string): string => escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>')

const prose = (text: string): string =>
  text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
    .map(paragraph => `<p>${inline(escapeHtml(paragraph)).replaceAll('\n', '<br>')}</p>`)
    .join('')

/** Fenced blocks become `<pre>`; everything between them is prose. An unclosed fence runs to the end. */
const renderMessage = (text: string): string => {
  const parts = text.split(/^```[^\n]*\n?/m)
  return parts.map((part, index) => (index % 2 === 1 ? `<pre><code>${escapeHtml(part.replace(/\n$/, ''))}</code></pre>` : prose(part))).join('')
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fafafa;--fg:#18181b;--muted:#71717a;--card:#fff;--border:#e4e4e7;--user:#eef2ff;--code:#f4f4f5}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--card:#18181b;--border:#27272a;--user:#1e1b4b;--code:#27272a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 4rem}h1{font-size:1.25rem;margin:0 0 .25rem}
.meta{color:var(--muted);font-size:.8rem;margin:0 0 1.5rem}.msg{border:1px solid var(--border);border-radius:.75rem;padding:.75rem 1rem;margin:0 0 .75rem;background:var(--card);overflow-wrap:anywhere}
.msg.user{background:var(--user)}.role{font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 .25rem}
.msg p{margin:.4rem 0}pre{background:var(--code);padding:.6rem .75rem;border-radius:.5rem;overflow-x:auto;font-size:.85rem}code{font:.85em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:0 .2em;border-radius:.25em}pre code{padding:0;background:none}
.note{color:var(--muted);font-size:.8rem;border-top:1px solid var(--border);padding-top:1rem;margin-top:2rem}form{display:flex;flex-direction:column;gap:.75rem;max-width:22rem}
input{font:inherit;padding:.5rem .75rem;border:1px solid var(--border);border-radius:.5rem;background:var(--card);color:var(--fg)}button{font:inherit;padding:.5rem .75rem;border:0;border-radius:.5rem;background:var(--fg);color:var(--bg);cursor:pointer}.error{color:#dc2626}
`

/** Seconds between reloads of a live page; long enough that a reader does not hammer the rate limit. */
export const LIVE_REFRESH_SECONDS = 30

const documentOf = (input: { readonly title: string; readonly body: string; readonly refresh?: boolean }): string =>
  [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">',
    '<meta name="referrer" content="no-referrer">',
    input.refresh === true ? `<meta http-equiv="refresh" content="${String(LIVE_REFRESH_SECONDS)}">` : '',
    `<title>${escapeHtml(input.title)}</title><style>${STYLE}</style></head><body><main>`,
    input.body,
    '</main></body></html>',
  ].join('')

const stamp = (epochMs: number): string =>
  new Date(epochMs)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC')

const metaLine = (content: PageContent): string => {
  const read =
    content.mode === 'live'
      ? `Live read-only view, read ${stamp(content.capturedAt)}; reloads every ${String(LIVE_REFRESH_SECONDS)} s.`
      : content.mode === 'snapshot'
        ? `Read-only snapshot taken ${stamp(content.capturedAt)}.`
        : `Exported ${stamp(content.capturedAt)}.`
  const expiry = content.expiresAt === null ? '' : ` Link expires ${stamp(content.expiresAt)}.`
  return `${read}${expiry}`
}

const renderTranscriptPage = (content: PageContent): string => {
  const messages =
    content.entries.length === 0
      ? '<p class="meta">This thread has no messages to show yet.</p>'
      : content.entries
          .map(
            entry =>
              `<article class="msg ${entry.role}"><p class="role">${entry.role === 'user' ? 'User' : 'Assistant'}</p>${renderMessage(entry.text)}</article>`,
          )
          .join('')
  const truncated = content.truncated ? '<p class="meta">Only the most recent messages are shown.</p>' : ''
  const body = [
    `<h1>${escapeHtml(content.title)}</h1>`,
    `<p class="meta">${escapeHtml(metaLine(content))}</p>`,
    truncated,
    messages,
    '<p class="note">Shared from DeepSeek Harness. Only user and assistant messages are shown; tool calls, files and other threads are not. Secret-looking values and home paths were redacted.</p>',
  ].join('')
  return documentOf({ title: content.title, body, refresh: content.mode === 'live' })
}

const renderPassphrasePage = (input: { readonly action: string; readonly failed: boolean }): string =>
  documentOf({
    title: 'Protected thread',
    body: [
      '<h1>This shared thread is protected</h1>',
      '<p class="meta">Enter the passphrase you were given with the link.</p>',
      input.failed ? '<p class="error" role="alert">Wrong passphrase. Check it with the person who shared the link and try again.</p>' : '',
      `<form method="post" action="${escapeHtml(input.action)}"><label for="passphrase">Passphrase</label>`,
      '<input id="passphrase" name="passphrase" type="password" autocomplete="off" required maxlength="256" autofocus>',
      '<button type="submit">Open thread</button></form>',
    ].join(''),
  })

const renderMessagePage = (input: { readonly heading: string; readonly detail: string }): string =>
  documentOf({ title: input.heading, body: `<h1>${escapeHtml(input.heading)}</h1><p class="meta">${escapeHtml(input.detail)}</p>` })

/** The three pages a share route answers with, plus the message renderer the export shares. */
export class SharePage {
  static readonly message = renderMessage
  static readonly transcript = renderTranscriptPage
  static readonly passphrase = renderPassphrasePage
  static readonly notice = renderMessagePage
}
