import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { FffSearch, FffSearchError } from './fff-search.js'

/** One search's root, narrowing and the Agent's working directory the paths come back relative to. */
const grepRequest = {
  scope: FffSearch.searchScope,
  pattern: Schema.String,
  include: Schema.optionalKey(Schema.String),
  workingDirectory: Schema.String,
}
const globRequest = { scope: FffSearch.searchScope, pattern: Schema.String, workingDirectory: Schema.String }
export type GrepRequest = Schema.Struct<typeof grepRequest>['Type']
export type GlobRequest = Schema.Struct<typeof globRequest>['Type']

/** The index process's whole surface; it serves it with `RpcServer`, the Host calls it with `RpcClient`. */
export class FffIndexRpcs extends RpcGroup.make(
  /** Build a root's index ahead of the first search. */
  Rpc.make('Warm', { payload: { root: Schema.String }, error: FffSearchError }),
  Rpc.make('Grep', { payload: grepRequest, success: FffSearch.grepOutcome, error: FffSearchError }),
  Rpc.make('Glob', { payload: globRequest, success: FffSearch.globOutcome, error: FffSearchError }),
) {}

/** What the Host hands the index process at spawn, as its only argument. */
export const fffIndexConfig = Schema.fromJsonString(Schema.Struct({ stateRoot: Schema.String }))
