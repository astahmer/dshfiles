/**
 * Redaction applied to every transcript line before it leaves the Host on a share page or in an export. It is a
 * best-effort pattern filter, not a guarantee: the share dialog says so, and a reader should still review a thread
 * before sharing it.
 */

export const REDACTED = '[redacted]'

interface Rule {
  readonly name: string
  readonly pattern: RegExp
  /** Replacement; `$1` keeps a captured prefix such as `api_key=`. */
  readonly replacement: string | ((match: string, prefix: string) => string)
}

/** `secret:ALIAS` and `secret:ALIAS@env` name a vault entry, not a value, so they stay readable. */
const SECRET_REFERENCE = /^secret:[A-Za-z0-9_.-]+(?:@[\w-]+)?$/

/** Ordered: the PEM block first, so its body is not half-matched by a shorter rule. */
const SECRET_RULES: readonly Rule[] = [
  { name: 'private-key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, replacement: REDACTED },
  { name: 'dsh-share-token', pattern: /\bdshs_[\w-]{20,}/g, replacement: REDACTED },
  { name: 'dsh-mcp-token', pattern: /\bdshmcp_[\w-]{20,}/g, replacement: REDACTED },
  { name: 'anthropic-openai-key', pattern: /\bsk-(?:ant-|proj-|live-|test-)?[\w-]{20,}/g, replacement: REDACTED },
  { name: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{22,})/g, replacement: REDACTED },
  { name: 'gitlab-token', pattern: /\bglpat-[\w-]{20,}/g, replacement: REDACTED },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: REDACTED },
  { name: 'slack-token', pattern: /\bxox[abeoprs]-[\w-]{10,}/g, replacement: REDACTED },
  { name: 'google-api-key', pattern: /\bAIza[\w-]{35}\b/g, replacement: REDACTED },
  { name: 'stripe-key', pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, replacement: REDACTED },
  { name: 'jwt', pattern: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g, replacement: REDACTED },
  { name: 'bearer', pattern: /\b(Bearer\s+)[\w.~+/-]{16,}=*/gi, replacement: `$1${REDACTED}` },
  { name: 'url-credentials', pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, replacement: `$1${REDACTED}@` },
  {
    name: 'assignment',
    pattern:
      /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|private[_-]?key|token|secret)["']?\s*[:=]\s*["']?)(?!secret:)[^\s"'`,;]{8,}/gi,
    replacement: (match, prefix) => (SECRET_REFERENCE.test(match) ? match : `${prefix}${REDACTED}`),
  },
]

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Home directories on the three platforms DSH runs on; the user name is the part a reader should not learn. */
const HOME_RULES: readonly Rule[] = [
  { name: 'mac-home', pattern: /\/Users\/[^/\s"'`]+/g, replacement: '~' },
  { name: 'linux-home', pattern: /\/home\/[^/\s"'`]+/g, replacement: '~' },
  { name: 'linux-root-home', pattern: /(^|[\s"'`(])\/root(?=\/|\b)/g, replacement: '$1~' },
  { name: 'windows-home', pattern: /\b[A-Za-z]:\\Users\\[^\\\s"'`]+/g, replacement: '~' },
]

export interface RedactionContext {
  /** The thread's working directory, shown as `<workspace>` so the page names no host path for it. */
  readonly workspace?: string | undefined
  /** The Host user's home directory, shown as `~`. */
  readonly home?: string | undefined
}

export interface RedactionResult {
  readonly text: string
  /** Names of the rules that changed the text, so a span can count them without logging what was hidden. */
  readonly rules: readonly string[]
}

const replaceLiteral = (text: string, literal: string | undefined, replacement: string): string => {
  if (literal === undefined) return text
  const trimmed = literal.replace(/[/\\]+$/, '')
  if (trimmed.length < 2) return text
  return text.replace(new RegExp(`${escapeRegExp(trimmed)}(?=$|[/\\\\\\s"'\`),.:;])`, 'g'), replacement)
}

/** Hide secret-shaped values, then the workspace path, the home directory and any other home path. */
export const redactText = (text: string, context: RedactionContext = {}): RedactionResult => {
  const rules: string[] = []
  let current = text
  for (const rule of SECRET_RULES) {
    const replacement = rule.replacement
    const next =
      typeof replacement === 'string'
        ? current.replace(rule.pattern, replacement)
        : current.replace(rule.pattern, (match: string, prefix: string) => replacement(match, prefix))
    if (next !== current) rules.push(rule.name)
    current = next
  }
  const withWorkspace = replaceLiteral(current, context.workspace, '<workspace>')
  if (withWorkspace !== current) rules.push('workspace-path')
  current = replaceLiteral(withWorkspace, context.home, '~')
  if (current !== withWorkspace) rules.push('home-path')
  for (const rule of HOME_RULES) {
    const next = typeof rule.replacement === 'string' ? current.replace(rule.pattern, rule.replacement) : current
    if (next !== current) rules.push(rule.name)
    current = next
  }
  return { text: current, rules }
}
