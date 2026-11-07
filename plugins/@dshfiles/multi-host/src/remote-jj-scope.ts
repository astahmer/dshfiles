import { posix } from 'node:path'
import { Option, Schema } from 'effect'

const decodeScope = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String, sessionId: Schema.optional(Schema.String) }))

const outsideThread = {
  ok: false,
  code: 'session/path-mismatch',
  message:
    "This action can only reach the remote thread's own folder. Reopen the panel if the host restarted, or open the thread on its host to work on another workspace.",
} as const

/**
 * A JJ action on a mirrored thread reaches that thread's own folder and nothing else: the runtime that owns a Session
 * is authorized for that Session, not for every path on its machine, so a caller cannot name another workspace.
 * @param input - the session, its folder as the owner reports it, and the action's own input.
 * @returns the refusal to show, or undefined when the action stays inside the thread.
 */
const refusal = (input: { readonly sessionId: string; readonly folder: string | undefined; readonly action: unknown }): typeof outsideThread | undefined => {
  const scope = decodeScope(input.action)
  if (Option.isNone(scope) || input.folder === undefined || scope.value.path !== input.folder) return outsideThread
  if (scope.value.sessionId !== undefined && scope.value.sessionId !== input.sessionId) return outsideThread
  return undefined
}

const decodeRepo = Schema.decodeUnknownOption(Schema.Struct({ repoId: Schema.String }))
const decodePath = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String }))
const decodeCwd = Schema.decodeUnknownOption(Schema.Struct({ cwd: Schema.String }))
const decodePaths = Schema.decodeUnknownOption(Schema.Struct({ paths: Schema.Array(Schema.String) }))
const decodeAction = Schema.decodeUnknownOption(Schema.Struct({ action: Schema.Struct({ kind: Schema.String, parentPath: Schema.optional(Schema.String) }) }))

/**
 * A repository call on a mirrored thread reaches that thread's repository and nothing else on the machine: folder calls
 * must name the thread's own folder, and every other call must carry a repository id the owner issued for that folder. A new workspace may only sit beside the thread's own folder.
 * @param input - the thread's folder, the ids issued for it, and the call's own input.
 * @returns the refusal to show, or undefined when the call stays inside the thread's repository.
 */
const repositoryRefusal = (input: {
  readonly folder: string | undefined
  readonly repoIds: ReadonlySet<string>
  readonly call: unknown
}): typeof outsideThread | undefined => {
  const { call, folder, repoIds } = input
  if (folder === undefined) return outsideThread
  const path = decodePath(call)
  if (Option.isSome(path)) return path.value.path === folder ? undefined : outsideThread
  const cwd = decodeCwd(call)
  if (Option.isSome(cwd)) return cwd.value.cwd === folder ? undefined : outsideThread
  const paths = decodePaths(call)
  if (Option.isSome(paths)) return paths.value.paths.every(item => item === folder) ? undefined : outsideThread
  const repo = decodeRepo(call)
  if (Option.isNone(repo) || !repoIds.has(repo.value.repoId)) return outsideThread
  const action = decodeAction(call)
  if (Option.isSome(action) && action.value.action.parentPath !== undefined && action.value.action.parentPath !== posix.dirname(folder)) return outsideThread
  return undefined
}

export class RemoteJjScope {
  static readonly refusal = refusal
  static readonly repositoryRefusal = repositoryRefusal
}
