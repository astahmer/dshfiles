const secretPatterns: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { label: 'api-key', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g },
  { label: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { label: 'slack-token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { label: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { label: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
]

const bearerPattern = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g
const assignmentPattern =
  /\b((?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*)(["']?)([^\s"',;]{4,})\2/gi

const escapeRegExp = (literal: string): string => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class Redaction {
  /** Literals shorter than this would redact ordinary words. */
  static readonly minLiteralLength = 6

  static redact(text: string, literals: readonly string[]): { readonly text: string; readonly count: number } {
    let count = 0
    const replace = (label: string) => (): string => {
      count++
      return `[REDACTED:${label}]`
    }
    let result = text
    for (const literal of literals) {
      if (literal.length < Redaction.minLiteralLength) continue
      result = result.replace(new RegExp(escapeRegExp(literal), 'g'), replace('secret'))
    }
    for (const { label, pattern } of secretPatterns) result = result.replace(pattern, replace(label))
    result = result.replace(bearerPattern, (_match, prefix: string) => {
      count++
      return `${prefix}[REDACTED:bearer]`
    })
    result = result.replace(assignmentPattern, (match, key: string, quote: string, value: string) => {
      if (value.startsWith('[REDACTED:')) return match
      count++
      return `${key}${quote}[REDACTED:secret]${quote}`
    })
    return { text: result, count }
  }
}
