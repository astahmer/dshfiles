import * as Schema from 'effect/Schema'
import { bookmarkNameSchema } from './api.js'

const isBookmarkName = Schema.is(bookmarkNameSchema)
/** How a dshx call rejected by the Host's input schema arrives (as jj-integration's own old-Host fallbacks read it). */
const isContractRejection = Schema.is(
  Schema.StructWithRest(Schema.Struct({ kind: Schema.Literal('contract') }), [Schema.Record(Schema.String, Schema.Unknown)]),
)

/**
 * Ask the Host with the project's main branch (`bookmark`) when it differs from `main`, the Host's own default. A name
 * the Host's schema would refuse is never sent, and a Host from before the optional field rejects it as a contract
 * error until DSH restarts: both read the `main` landmarks instead of failing the view.
 */
const withProjectBookmark = async <Result>(input: {
  readonly bookmark: string | undefined
  readonly read: (bookmark: string | undefined) => Promise<Result>
}): Promise<Result> => {
  const bookmark = input.bookmark !== undefined && input.bookmark !== 'main' && isBookmarkName(input.bookmark) ? input.bookmark : undefined
  if (bookmark === undefined) return input.read(undefined)
  return input.read(bookmark).catch((error: unknown) => {
    if (!isContractRejection(error)) throw error
    return input.read(undefined)
  })
}

export const ProjectBookmarkRequest = { withProjectBookmark } as const
