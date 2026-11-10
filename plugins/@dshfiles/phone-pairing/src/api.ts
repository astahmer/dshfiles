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
