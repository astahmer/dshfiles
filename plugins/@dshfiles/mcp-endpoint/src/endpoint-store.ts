import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { pluginStorage } from '@dshfiles/dshx/host'
import { z } from 'zod'

const NAMESPACE = '@dshfiles/mcp-endpoint'
const TOKEN_KEY = 'token'
const LAN_KEY = 'lan-enabled'
const TOKEN_PREFIX = 'dshmcp_'

const storedTokenSchema = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), createdAt: z.number() }).strict()

const digest = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest()

/** Only the token's SHA-256 is stored: the value leaves the Host once, in the rotate response. */
export const createEndpointStore = (ctx: Context) => {
  const storage = pluginStorage(ctx, NAMESPACE)
  const readToken = async () => storedTokenSchema.safeParse((await storage.get(TOKEN_KEY))?.value).data
  return {
    tokenInfo: async () => {
      const stored = await readToken()
      return stored === undefined ? null : { createdAt: stored.createdAt }
    },
    lanEnabled: async () => (await storage.get(LAN_KEY))?.value === true,
    setLanEnabled: async (enabled: boolean) => {
      await storage.set(LAN_KEY, enabled)
    },
    rotate: async () => {
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
      await storage.set(TOKEN_KEY, { sha256: digest(token).toString('hex'), createdAt: Date.now() })
      return token
    },
    revoke: async () => {
      await storage.delete(TOKEN_KEY)
    },
    /** `missing` when no token was ever issued, so the refusal can say where to issue one. */
    verify: async (presented: string): Promise<'valid' | 'invalid' | 'missing'> => {
      const stored = await readToken()
      if (stored === undefined) return 'missing'
      return timingSafeEqual(digest(presented), Buffer.from(stored.sha256, 'hex')) ? 'valid' : 'invalid'
    },
  }
}

export type EndpointStore = ReturnType<typeof createEndpointStore>
