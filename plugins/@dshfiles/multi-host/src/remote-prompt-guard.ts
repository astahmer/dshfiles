import { posix } from 'node:path'

/** Where an upload receipt was staged, so a prompt on another Session or machine can be told apart from a stale one. */
export interface StagedUpload {
  readonly runtimeId: string
  readonly sessionId: string
}

/** The `@path` grammar of the native reference chips, send-time serialization and the model prompt. */
const mentionPattern = /(?:^|\s)@(?:"([^"\n]*)"?|([^\s"]\S*))/gu

const withoutTrailingSlashes = (path: string): string => path.replace(/\/+$/u, '')

const isInside = (path: string, root: string): boolean => {
  const base = withoutTrailingSlashes(root)
  return base !== '' && (path === base || path.startsWith(`${base}/`))
}

/** Every `@` mention in the text, unquoted; prose paths are not references and stay out of this list. */
const mentionsOf = (text: string): readonly string[] =>
  [...text.matchAll(mentionPattern)].flatMap(match => {
    const path = match[1] ?? match[2]
    return path === undefined || path === '' ? [] : [path]
  })

/**
 * The first `@` mention that names this machine: `~`, or an absolute path under this Host's home that is not inside
 * the remote thread's own folder. Two machines can share a home path, so the thread's folder wins over the home.
 */
const localMention = (input: { readonly text: string; readonly localHome: string; readonly cwd: string | undefined }): string | undefined =>
  mentionsOf(input.text).find(path => {
    if (path === '~' || path.startsWith('~/')) return true
    if (!path.startsWith('/')) return false
    const normalized = posix.normalize(path)
    if (input.cwd !== undefined && isInside(normalized, input.cwd)) return false
    return isInside(normalized, input.localHome)
  })

const localPathRefusal = (input: {
  readonly text: string
  readonly localHome: string
  readonly cwd: string | undefined
  readonly hostName: string
}): string | undefined => {
  const mention = localMention(input)
  if (mention === undefined) return undefined
  return `"@${mention}" points to this machine, but this thread runs on ${input.hostName}. Attach the file to send it there, or use a path relative to the thread's folder.`
}

const foreignUploadRefusal = (input: {
  readonly receiptIds: readonly string[]
  readonly staged: ReadonlyMap<string, StagedUpload>
  readonly runtimeId: string
  readonly sessionId: string
  readonly hostName: string
}): string | undefined => {
  const foreign = input.receiptIds.some(receiptId => {
    const upload = input.staged.get(receiptId)
    return upload !== undefined && (upload.runtimeId !== input.runtimeId || upload.sessionId !== input.sessionId)
  })
  return foreign ? `An attachment was uploaded for another thread, so ${input.hostName} cannot read it. Remove it and attach the file again here.` : undefined
}

/** What the owning runtime's `session/attachment-invalid` means for this message. */
const attachmentNotStagedMessage = (hostName: string): string =>
  `${hostName} does not have this attachment: it was uploaded to another machine or has expired there. Remove it and attach the file again.`

/** Refuse a message that names this machine before it reaches the runtime that owns the thread. */
export class RemotePromptGuard {
  static readonly mentionsOf = mentionsOf
  static readonly localMention = localMention
  static readonly localPathRefusal = localPathRefusal
  static readonly foreignUploadRefusal = foreignUploadRefusal
  static readonly attachmentNotStagedMessage = attachmentNotStagedMessage
}
