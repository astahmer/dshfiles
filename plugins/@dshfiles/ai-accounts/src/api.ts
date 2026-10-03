import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/**
 * Typed wire contract between the Host and the Accounts settings page.
 *
 * Only what the page renders crosses here: which homes exist, which hold a
 * login, and how the pool is currently spreading requests. No token, no
 * `auth.json` content.
 */

export const accountKindSchema = z.enum(['codex', 'opencode-go'])

export const accountStateSchema = z.enum(['healthy', 'cooling', 'disabled'])

export const accountRowSchema = z.object({
  /** Routing slug the model picker shows, e.g. `codex_personal`. */
  instanceId: z.string().min(1).max(64),
  kind: accountKindSchema,
  displayName: z.string().min(1).max(120),
  enabled: z.boolean(),
  /** `direct` reads the shared home; `authOverlay` owns a private auth.json. */
  mode: z.string().min(1).max(32),
  sharedHomePath: z.string().max(1024),
  effectiveHomePath: z.string().max(1024),
  /** The exact command that signs this account in. Never a credential. */
  loginHint: z.string().max(2048),
  signedIn: z.boolean(),
  identity: z.string().max(320).nullable(),
  plan: z.string().max(64).nullable(),
  state: accountStateSchema,
  cooldownUntil: z.number().nullable(),
  detail: z.string().max(400).nullable(),
})

export const accountsSnapshotSchema = z.object({
  distribution: z.enum(['sticky', 'priority', 'round-robin', 'balanced']),
  distributions: z.array(z.enum(['sticky', 'priority', 'round-robin', 'balanced'])),
  cooldownMs: z.number().min(0),
  accounts: z.array(accountRowSchema).max(64),
})

export type AccountKind = z.infer<typeof accountKindSchema>
export type AccountRow = z.infer<typeof accountRowSchema>
export type AccountsSnapshot = z.infer<typeof accountsSnapshotSchema>

export const aiAccountsApi = defineApi({
  id: 'ai-accounts',
  version: 1,
  methods: {
    /** Read the current account table; the page renders this and nothing else. */
    snapshot: method({
      input: z.void(),
      output: accountsSnapshotSchema,
    }),
  },
})