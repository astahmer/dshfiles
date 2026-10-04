import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * Read one ChatGPT access token from a Codex home.
 *
 * Codex owns login and refresh; this plugin never persists, refreshes or logs a
 * credential. A later request sees whatever Codex last wrote, so an expired
 * login fails loudly here instead of silently falling back to an API key.
 */
export const readCodexAccessToken = async (codexHome: string): Promise<string> => {
  const path = join(codexHome, 'auth.json')
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new LlmError(`No readable Codex login at ${path}. Sign in with \`CODEX_HOME="${codexHome}" codex login\`.`, 'MISSING_CREDENTIAL')
  }
  let auth: Record<string, unknown>
  try {
    auth = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new LlmError(`Codex login at ${path} is not valid JSON.`, 'INVALID_CREDENTIAL')
  }
  const tokens = (auth.tokens ?? {}) as Record<string, unknown>
  const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  const apiKeyOnly = typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.length > 0
  const wrongMode = auth.auth_mode !== undefined && auth.auth_mode !== 'chatgpt'
  if (accessToken.length === 0 || apiKeyOnly || wrongMode) {
    throw new LlmError(`Codex login at ${path} has no ChatGPT access token. Sign in with ChatGPT, not an API key.`, 'MISSING_CREDENTIAL')
  }
  return accessToken
}
