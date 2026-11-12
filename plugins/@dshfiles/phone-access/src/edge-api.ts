/**
 * The phone edge contract: phone-access owns the loopback proxy that the machine's tailnet address (or a
 * configured origin) points at. Another Host plugin that needs public routes on that same address, such as
 * phone-pairing's `/pair` page and its paired-device cookie, claims them here instead of repointing Tailscale itself.
 * Claimed requests are forwarded unchanged to the claimer's loopback port; everything else keeps reaching the native
 * listener as before.
 *
 * This module imports no claimer: it is the token both sides share (docs/plugin-boundaries.md).
 */
import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const port = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65_535 }))
const pathPrefix = Schema.String.check(Schema.isPattern(/^\/[A-Za-z0-9._~/-]{1,63}$/u))
const cookieName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}$/u))

export const phoneEdgeStatusSchema = Schema.Struct({
  /** The loopback proxy is listening, so the origins below reach this DSH. */
  listening: Schema.Boolean,
  /** The proxy's loopback port. */
  port,
  /** Public HTTPS origins that reach the proxy: configured ones, or the detected tailnet name. Empty when none. */
  origins: Schema.Array(Schema.String.check(Schema.isMaxLength(2_048))),
  /** phone-access pointed Tailscale Serve at the proxy itself (autoServe). */
  served: Schema.Boolean,
  /** Packages that currently claim routes on the proxy. */
  claims: Schema.Array(Schema.String.check(Schema.isMaxLength(200))),
})

export type PhoneEdgeStatus = Schema.Schema.Type<typeof phoneEdgeStatusSchema>

export const phoneEdgeClaimSchema = Schema.Struct({
  /** Loopback port the claimed requests are forwarded to, unchanged. */
  port,
  /** Paths that belong to the claimer: `/pair` matches `/pair` and `/pair/…`. */
  pathPrefixes: Schema.Array(pathPrefix).check(Schema.isMaxLength(4)),
  /** Requests carrying this cookie belong to the claimer too (a paired device's own credential). */
  cookie: Schema.optionalKey(cookieName),
  /**
   * A page on the claimed paths where a phone signs in (phone-pairing: `/pair`). A phone that opens this origin
   * signed out gets a link to it instead of the native listener's bare 401.
   */
  signIn: Schema.optionalKey(Schema.Struct({ path: pathPrefix, label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)) })),
})

export type PhoneEdgeClaim = Schema.Schema.Type<typeof phoneEdgeClaimSchema>

export const phoneEdgeApi = defineApi({
  id: 'phone-access-edge',
  version: 1,
  owner: '@dshfiles/phone-access',
  methods: {
    status: method({
      input: Schema.Struct({}),
      output: phoneEdgeStatusSchema,
      description: 'Whether the phone-access proxy listens, the public origins that reach it, and who claims routes on it. Read-only.',
    }),
    claimRoutes: method({
      input: phoneEdgeClaimSchema,
      output: phoneEdgeStatusSchema,
      description:
        'Host plugins only: forward the given paths, and requests carrying the given cookie, to a loopback port on the same public origin. Replaces the caller package’s earlier claim.',
    }),
    releaseRoutes: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ released: Schema.Boolean }),
      description: 'Host plugins only: drop the caller package’s route claim; its requests reach the native listener again.',
    }),
  },
})
