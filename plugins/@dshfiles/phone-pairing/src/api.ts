import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const pairingOfferSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('off') }),
  Schema.Struct({
    state: Schema.Literal('ready'),
    /** `origin/pair#id=…&secret=…`; scanning it redeems the offer once. */
    payload: Schema.String.check(Schema.isMaxLength(2_048)),
    code: Schema.String.check(Schema.isPattern(/^\d{6}$/u)),
    expiresAt: Schema.Number.check(Schema.isFinite()),
    origin: Schema.String.check(Schema.isMaxLength(2_048)),
  }),
])

export type PairingOffer = Schema.Schema.Type<typeof pairingOfferSchema>

const port = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65_535 }))

/**
 * Why phone access could not turn on, as data: a busy gateway port names who holds it and a free port to use instead;
 * a missing tunnel or native listener says what to start.
 */
export const accessProblemSchema = Schema.Struct({
  reason: Schema.Literals(['port-busy', 'no-tunnel', 'no-listener', 'failed']),
  /** The loopback gateway port that was tried. */
  port: Schema.optional(port),
  /** A free port next to it, to pass to `phone_pairing_enable`. */
  suggestedPort: Schema.optional(port),
  /** The program listening on a busy port: "this DSH" or `name (pid N)`. */
  holder: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  /** The busy port belongs to this DSH process, i.e. another plugin (Phone access QR) listens there. */
  holderSelf: Schema.optional(Schema.Boolean),
})

export type AccessProblem = Schema.Schema.Type<typeof accessProblemSchema>

/** Whether phone access is on and, when it is, the public origin a phone opens; `phone_pairing_status` reports it. */
export const pairingStatusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  origin: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
  /** The gateway port while it is on. */
  port: Schema.optional(port),
  /** `shared`: on Phone access QR's origin; `own`: phone pairing's own tunnel or manual origin. */
  mode: Schema.optional(Schema.Literals(['shared', 'own'])),
  /** Why the last attempt to turn it on failed, with what to change (a busy port, a missing tunnel CLI, an unset origin). */
  failure: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
  /** The same failure as data. */
  problem: Schema.optional(accessProblemSchema),
})

export type PairingStatus = Schema.Schema.Type<typeof pairingStatusSchema>

/** One code per click: the terminal `phone_pairing_code` tool and this button mint from the same store. */
export const phonePairingApi = defineApi({
  id: 'phone-pairing',
  version: 1,
  owner: '@dshfiles/phone-pairing',
  methods: {
    offer: method({
      input: Schema.Struct({}),
      output: pairingOfferSchema,
      description:
        'Mint one single-use phone pairing offer for the sidebar QR popover: the scanned URL and its 6-digit code, or that phone access is off. Call only when the user asked for a pairing code.',
    }),
  },
})
