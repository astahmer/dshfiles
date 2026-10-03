import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * Wire contract for the accounts page.
 *
 * The page edits account profiles, so every operation lives here rather than in
 * the view. The page and the agent's `ai_accounts` tool read the same file
 * through the same Host method, so they can never disagree.
 *
 * No token and no `auth.json` content ever crosses: an account reports whether
 * it holds a login, the identity it presents, and the command that creates one.
 */

export const accountKindSchema = z.enum(['codex', 'opencode-go', 'commandcode'])

export const accountModeSchema = z.enum(['direct', 'authOverlay'])

export const accountStateSchema = z.enum(['healthy', 'cooling', 'disabled', 'unconfigured'])

export const accountProfileSchema = z.object({
  /** Routing slug the model picker shows, e.g. `codex_personal`. */
  instanceId: z.string().min(1).max(64),
  kind: accountKindSchema,
  displayName: z.string().min(1).max(120),
  enabled: z.boolean(),
  /** Home this account reads shared Codex state from. */
  homePath: z.string().max(1024),
  /** Per-account home holding a private `auth.json`; empty means the shared home. */
  shadowHomePath: z.string().max(1024),
  /** Keyed accounts name an environment variable instead of carrying a value. */
  apiKeyEnv: z.string().max(256),
  /** Command Code accounts may point at a different API base. */
  apiBaseUrl: z.string().max(512),
  badge: z.string().max(32),
  accentColor: z.string().max(32),
  providerIcon: z.string().max(32),
  mode: accountModeSchema,
  signedIn: z.boolean(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  state: accountStateSchema,
  /** The exact command that signs this account in. Never a credential. */
  loginHint: z.string().max(2048),
  detail: z.string().max(400).nullable(),
  additionalModelIds: z.array(z.string().max(120)).max(32),
  /**
   * Default reasoning effort per model id. Absent means the provider's own
   * default, so an account only lists the models it wants to pin.
   */
  reasoningDefaults: z.record(z.string().max(160), z.string().max(32)).default({}),
})

/** What the page may write: identity and health are observed, never authored. */
export const accountDraftSchema = accountProfileSchema.pick({
  instanceId: true,
  kind: true,
  displayName: true,
  enabled: true,
  homePath: true,
  shadowHomePath: true,
  apiKeyEnv: true,
  apiBaseUrl: true,
  badge: true,
  accentColor: true,
  providerIcon: true,
  additionalModelIds: true,
  reasoningDefaults: true,
})

export const accountsFileSchema = z.object({
  distribution: z.enum(['sticky', 'priority', 'round-robin', 'balanced']),
  cooldownMs: z.number().int().min(0).max(86_400_000),
  shadowRoot: z.string().max(1024),
  accounts: z.array(accountProfileSchema).max(64),
})

export const usageCardSchema = z.object({
  status: z.enum(['ok', 'unauthenticated', 'unsupported', 'rate-limited', 'error']),
  message: z.string().max(300).nullable(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  windows: z
    .array(
      z.object({
        label: z.string().max(32),
        percentRemaining: z.number(),
        resetsAt: z.number().nullable(),
      }),
    )
    .max(6),
  bankedResets: z.number().int().min(0).max(20),
  /** When each banked reset expires, when the provider reports it. */
  bankedResetExpiries: z.array(z.number().nullable()).max(20),
})

export const accountsUsageSchema = z.object({
  /** Read when the panel opened, so a full sweep is not made on every render. */
  readAt: z.number(),
  cards: z.array(
    z.object({
      instanceId: z.string().min(1).max(64),
      usage: usageCardSchema,
    }),
  ),
})

export const accountsCatalogSchema = z.object({
  instanceId: z.string().min(1).max(64),
  models: z.array(
    z.object({
      id: z.string().min(1).max(200),
      name: z.string().max(200),
      efforts: z.array(z.object({ id: z.string().max(64), name: z.string().max(80) })).max(12),
      defaultEffort: z.string().max(32).nullable(),
    }),
  ),
})

export type AccountsCatalog = z.infer<typeof accountsCatalogSchema>
export type UsageCard = z.infer<typeof usageCardSchema>
export type AccountsUsage = z.infer<typeof accountsUsageSchema>

export const identityResultSchema = z.object({
  instanceId: z.string().min(1).max(64),
  email: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  signedIn: z.boolean(),
})

export type AccountProfile = z.infer<typeof accountProfileSchema>
export type AccountDraft = z.infer<typeof accountDraftSchema>
export type AccountsFile = z.infer<typeof accountsFileSchema>
export type AccountKind = z.infer<typeof accountKindSchema>

/** Icon names the page offers, matching the reference account page. */
export const PROVIDER_ICONS = [
  'Bot',
  'Rocket',
  'Sparkles',
  'Terminal',
  'Layers',
  'Brain',
  'Globe',
  'Code',
  'Gem',
] as const

export const aiAccountsApi = defineApi({
  id: 'ai-accounts',
  version: 1,
  methods: {
    /** Read the whole file: distribution plus every account. */
    read: method({ input: z.void(), output: accountsFileSchema }),
    /** Create or update one account by its instance id. */
    save: method({
      input: z.object({ draft: accountDraftSchema }),
      output: accountsFileSchema,
    }),
    /** Remove one account. */
    remove: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: accountsFileSchema,
    }),
    /** Change how requests are spread across accounts. */
    setDistribution: method({
      input: z.object({ distribution: accountsFileSchema.shape.distribution }),
      output: accountsFileSchema,
    }),
    /**
     * Read the identity an account currently presents, creating its shadow home
     * on first use so a fresh `codex login` writes to the right place.
     */
    identity: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: identityResultSchema,
    }),
    /**
     * One account's model catalog with the reasoning levels each model
     * supports, so the panel can offer a default effort per model instead of
     * guessing what a model accepts.
     */
    catalog: method({
      input: z.object({ instanceId: z.string().min(1).max(64) }),
      output: z.object({
        instanceId: z.string().min(1).max(64),
        models: z.array(
          z.object({
            id: z.string().min(1).max(200),
            name: z.string().max(200),
            efforts: z.array(z.object({ id: z.string().max(64), name: z.string().max(80) })).max(12),
            defaultEffort: z.string().max(32).nullable(),
          }),
        ),
      }),
    }),
    /**
     * Live subscription quota for every account. Each card is read with its own
     * credential and a short timeout, so one unreachable provider degrades one
     * card rather than the panel.
     */
    usage: method({ input: z.void(), output: accountsUsageSchema }),
  },
})