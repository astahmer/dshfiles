import { Option, Schema } from 'effect'

const decodeScope = Schema.decodeUnknownOption(Schema.Struct({ path: Schema.String, sessionId: Schema.optional(Schema.String) }))

const outsideThread = {
  ok: false,
  code: 'session/path-mismatch',
  message: "This action can only reach the remote thread's own folder. Open the thread on its host to work on another workspace.",
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

export class RemoteJjScope {
  static readonly refusal = refusal
}
