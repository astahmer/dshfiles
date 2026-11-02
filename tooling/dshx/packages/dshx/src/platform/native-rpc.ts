import * as Schema from 'effect/Schema'

const strictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) => {
  const struct = Schema.Struct(fields)
  return Schema.decodeTo(struct)(
    Schema.StructWithRest(struct, [
      Schema.Record(Schema.String.check(Schema.makeFilter(key => !Object.prototype.hasOwnProperty.call(fields, key))), Schema.Never),
    ]),
  )
}

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const sessionRequest = <Request extends Schema.Constraint>(schema: Request) => strictStruct({ request: schema })
const sessionAddressSchema = strictStruct({ kind: Schema.Literal('session'), sessionId: sessionIdSchema })

export const nativeRpcRequestSchema = Schema.Union([
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('list'),
    args: strictStruct({
      _request: Schema.optional(strictStruct({ projections: Schema.optional(Schema.Array(Schema.String)) })),
    }),
  }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('search'),
    args: sessionRequest(strictStruct({ query: Schema.String.check(Schema.isMaxLength(4000)) })),
  }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('create'),
    args: sessionRequest(
      strictStruct({
        cwd: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
        agentPreset: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
      }),
    ),
  }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('fork'),
    args: sessionRequest(
      strictStruct({
        sessionId: sessionIdSchema,
        atSeq: Schema.optional(
          Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(0)),
        ),
      }),
    ),
  }),
  strictStruct({ namespace: Schema.Literal('session'), method: Schema.Literal('cancel'), args: sessionRequest(strictStruct({ sessionId: sessionIdSchema })) }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('rename'),
    args: sessionRequest(strictStruct({ sessionId: sessionIdSchema, title: Schema.String.check(Schema.isMaxLength(512)) })),
  }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('prompt'),
    args: sessionRequest(
      strictStruct({
        requestId: Schema.String.check(Schema.isUUID()),
        sessionId: sessionIdSchema,
        mode: Schema.Literals(['queue', 'steer']),
        content: Schema.Array(strictStruct({ type: Schema.Literal('text'), text: Schema.String.check(Schema.isMaxLength(100_000)) })).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(64),
        ),
      }),
    ),
  }),
  strictStruct({
    namespace: Schema.Literal('session'),
    method: Schema.Literal('page'),
    args: sessionRequest(
      strictStruct({
        address: sessionAddressSchema,
        throughSeq: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(-1)),
        beforeSeq: Schema.optional(
          Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.makeFilter(Number.isSafeInteger), Schema.isGreaterThanOrEqualTo(-1)),
        ),
        maxMessages: Schema.optional(
          Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1000)),
        ),
      }),
    ),
  }),
  strictStruct({
    namespace: Schema.Literal('workspace'),
    method: Schema.Literal('archiveSession'),
    args: sessionRequest(strictStruct({ sessionId: sessionIdSchema })),
  }),
  strictStruct({
    namespace: Schema.Literal('workspace'),
    method: Schema.Literal('unarchiveSession'),
    args: sessionRequest(strictStruct({ sessionId: sessionIdSchema })),
  }),
])

export type NativeRpcRequest = Schema.Schema.Type<typeof nativeRpcRequestSchema>
