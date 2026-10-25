import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { OAuthCredential } from '@earendil-works/pi-ai'

const decodeJwtPayload = (token: string): Record<string, unknown> | undefined => {
  const segment = token.split('.')[1]
  if (segment === undefined) return undefined
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * pi-ai credential plumbing for one Codex account.
 *
 * pi-ai's codex protocol lives behind an OAuth-only provider, so the token this
 * plugin resolved for the request has to arrive as a stored OAuth credential
 * rather than as an api-key override. The account's own `auth.json` is the
 * datum already materialized for CODEX_HOME, so the credential is read from
 * there and every rotated token pi hands back through `modify` is written into
 * the same file — Codex CLI keeps owning the secret store, and a later request
 * (this plugin's or Codex's own) sees the fresh token.
 */
const readString = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

const AUTH_CLAIM = 'https://api.openai.com/auth'

export const readCodexOAuthCredential = async (codexHome: string): Promise<OAuthCredential | undefined> => {
  const path = join(codexHome, 'auth.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new LlmError(`No readable Codex login at ${path}. Sign in with \`CODEX_HOME="${codexHome}" codex login\`.`, 'MISSING_CREDENTIAL')
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new LlmError(`Codex login at ${path} is not valid JSON.`, 'INVALID_CREDENTIAL')
  }
  const tokens = (parsed.tokens ?? {}) as Record<string, unknown>
  const access = readString(tokens.access_token)
  const refresh = readString(tokens.refresh_token)
  if (access === undefined || refresh === undefined) {
    throw new LlmError(`Codex login at ${path} has no ChatGPT token pair. Sign in with ChatGPT, not an API key.`, 'MISSING_CREDENTIAL')
  }
  const claims = decodeJwtPayload(access) ?? {}
  const auth = (claims[AUTH_CLAIM] ?? {}) as Record<string, unknown>
  const accountId = readString(auth.chatgpt_account_id)
  const expiresClaim = typeof claims.exp === 'number' ? claims.exp : undefined
  return {
    type: 'oauth',
    access,
    refresh,
    // A missing exp claim forces pi-ai to refresh before it serves anything.
    expires: expiresClaim === undefined ? 0 : expiresClaim * 1000,
    ...(accountId !== undefined && { accountId }),
    persist: false,
  }
}

/** Apply a rotated pi-ai token to the account's `auth.json`, atomically. */
export const persistCodexOAuthCredential = async (codexHome: string, credential: OAuthCredential): Promise<void> => {
  const path = join(codexHome, 'auth.json')
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  if (raw === undefined) return
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const tokens = (parsed.tokens ?? {}) as Record<string, unknown>
  tokens.access_token = credential.access
  tokens.refresh_token = credential.refresh
  parsed.tokens = tokens
  parsed.last_refresh = new Date().toISOString()
  const tmp = `${path}.ai-accounts-tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
}
