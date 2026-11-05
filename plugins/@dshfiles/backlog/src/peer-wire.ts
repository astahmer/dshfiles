import { Schema } from 'effect'

/** What backlog Hosts exchange to replicate the op log: shared by the API contract and the Host that decodes a peer's answers. */

const countSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const idSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

const infoSchema = Schema.Struct({
  hostId: idSchema,
  /** Bumped when the peer reads change shape; Hosts on different protocols never pull from each other. */
  protocol: countSchema,
  /** The op kinds this Host writes (`BacklogOps.schemaVersion`); a Host refuses ops from a newer one. */
  opSchema: countSchema,
  /** How many storage migrations this Host ran. */
  dbSchema: countSchema,
  /** The Host this one runs background automation on, or null when it runs it itself. */
  automationHostId: Schema.NullOr(idSchema),
})

const opSchema = Schema.Struct({
  seq: countSchema,
  opId: idSchema,
  itemId: idSchema,
  hlc: Schema.Struct({ wall: countSchema, counter: countSchema, host: idSchema }),
  origin: Schema.String.check(Schema.isMaxLength(512)),
  /** The op as stored JSON; the receiver decodes it with the op schema before anything is written. */
  op: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(4_000_000)),
})

const opsPageSchema = Schema.Struct({
  hostId: idSchema,
  head: countSchema,
  more: Schema.Boolean,
  ops: Schema.Array(opSchema).check(Schema.isMaxLength(2_000)),
})

const fileKeySchema = Schema.Struct({ itemId: idSchema, attachmentId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)) })

const filesInputSchema = Schema.Struct({ files: Schema.Array(fileKeySchema).check(Schema.isMinLength(1), Schema.isMaxLength(16)) })

const filesOutputSchema = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      ...fileKeySchema.fields,
      sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
      mediaType: Schema.String.check(Schema.isMaxLength(255)),
      data: Schema.String,
    }),
  ),
  missing: Schema.Array(fileKeySchema),
})

export type PeerInfo = typeof infoSchema.Type
export type PeerOpsPage = typeof opsPageSchema.Type
export type PeerFileKey = typeof fileKeySchema.Type
export type PeerFiles = typeof filesOutputSchema.Type

export class BacklogPeerWire {
  /** Bumped whenever a peer read changes shape. */
  static readonly protocol = 1
  static readonly idSchema = idSchema
  static readonly infoSchema = infoSchema
  static readonly opsPageSchema = opsPageSchema
  static readonly filesInputSchema = filesInputSchema
  static readonly filesOutputSchema = filesOutputSchema
}
