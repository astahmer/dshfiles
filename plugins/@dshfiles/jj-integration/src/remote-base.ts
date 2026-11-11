/**
 * A thread workspace may start from a remote bookmark (`main@origin` in jj, `origin/main` in git) instead of a local
 * one. The Host fetches that one bookmark first, so the workspace starts from what the remote holds now rather than
 * whatever the last fetch saw — the "start from origin" choice of other agent tools.
 */

export interface RemoteBase {
  readonly name: string
  readonly remote: string
}

/** Remote bookmarks offered in the destination bar; a repository with thousands of remote branches lists the first. */
export const MAX_REMOTE_BOOKMARKS = 200

/** jj's own pseudo-remote for the colocated git refs; it is never fetched and never offered. */
const JJ_GIT_REMOTE = 'git'

/** `name@remote` when `remote` is one of the repository's remotes, else the text is a local bookmark or a revision. */
const parseJj = (base: string, remotes: readonly string[]): RemoteBase | undefined => {
  const at = base.lastIndexOf('@')
  if (at <= 0) return undefined
  const name = base.slice(0, at)
  const remote = base.slice(at + 1)
  return remote !== JJ_GIT_REMOTE && remotes.includes(remote) ? { name, remote } : undefined
}

/** `remote/name`; with nested remote names (`a` and `a/b`) the longest one that matches wins, as git resolves them. */
const parseGit = (base: string, remotes: readonly string[]): RemoteBase | undefined => {
  const remote = [...remotes].sort((left, right) => right.length - left.length).find(candidate => base.startsWith(`${candidate}/`))
  if (remote === undefined) return undefined
  const name = base.slice(remote.length + 1)
  return name.length === 0 || name === 'HEAD' ? undefined : { name, remote }
}

/** The jj revset that names exactly that remote bookmark, whatever characters its name holds. */
const jjRevset = (base: RemoteBase): string => `remote_bookmarks(exact:${JSON.stringify(base.name)}, remote=exact:${JSON.stringify(base.remote)})`

/**
 * The project's main branch first on each remote (`main@origin` before `main@upstream`), then the rest in the order the
 * VCS listed them, deduplicated and capped.
 */
const ordered = (input: { readonly refs: readonly RemoteBase[]; readonly preferred: string; readonly format: (base: RemoteBase) => string }): string[] => {
  const preferred = input.refs.filter(ref => ref.name === input.preferred)
  const others = input.refs.filter(ref => ref.name !== input.preferred)
  return [...new Set([...preferred, ...others].map(input.format))].slice(0, MAX_REMOTE_BOOKMARKS)
}

export class RemoteBaseModel {
  static readonly parseJj = parseJj
  static readonly parseGit = parseGit
  static readonly jjRevset = jjRevset
  static readonly formatJj = (base: RemoteBase): string => `${base.name}@${base.remote}`
  static readonly formatGit = (base: RemoteBase): string => `${base.remote}/${base.name}`
  static readonly ordered = ordered
}
