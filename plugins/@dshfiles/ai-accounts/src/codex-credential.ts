import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { decodeJson, jsonObjectSchema, type JsonObject } from '@dshfiles/dshx/json'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import { AccountCredentialHomeWork } from './account-credential-home-work.js'
import { CodexHomeModel, materializeCodexShadowHome, type CodexHomeInput, type CodexHomeLayout } from './codex-home.js'

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
  let parsed: JsonObject
  try {
    parsed = decodeJson(jsonObjectSchema, raw)
  } catch {
    throw new LlmError(`Codex login at ${path} is not a JSON object.`, 'INVALID_CREDENTIAL')
  }
  const tokens = CodexHomeModel.objectField(parsed.tokens)
  const access = readString(tokens.access_token)
  const refresh = readString(tokens.refresh_token)
  if (access === undefined || refresh === undefined) {
    throw new LlmError(`Codex login at ${path} has no ChatGPT token pair. Sign in with ChatGPT, not an API key.`, 'MISSING_CREDENTIAL')
  }
  const claims = CodexHomeModel.decodeJwtPayload(access) ?? {}
  const auth = CodexHomeModel.objectField(claims[AUTH_CLAIM])
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
  let parsed: JsonObject
  try {
    parsed = decodeJson(jsonObjectSchema, raw)
  } catch {
    return
  }
  // Keep every field Codex CLI wrote; only the token pair and the refresh time change.
  const next = {
    ...parsed,
    tokens: { ...CodexHomeModel.objectField(parsed.tokens), access_token: credential.access, refresh_token: credential.refresh },
    last_refresh: new Date().toISOString(),
  }
  const tmp = `${path}.ai-accounts-tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
}

/** The pi-ai credential read and refresh of one Codex account home, serialized with every other operation on that home. */
export class CodexCredentialStore {
  static readonly resolveLayout = (input: CodexHomeInput): CodexHomeLayout => CodexHomeModel.resolveLayout(input)

  static readonly forLayout = (layout: CodexHomeLayout) => {
    const codexHome = layout.effectiveHomePath
    const read = async (): Promise<OAuthCredential | undefined> => {
      await materializeCodexShadowHome(layout)
      return readCodexOAuthCredential(codexHome)
    }
    const modify = (mutate: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> =>
      AccountCredentialHomeWork.update(codexHome, {
        read,
        mutate,
        persist: async next => {
          if (next !== undefined && next.type === 'oauth') await persistCodexOAuthCredential(codexHome, next)
        },
      })
    return { read, modify }
  }
}
