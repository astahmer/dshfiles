import { Schema } from 'effect'

/** The forge a repository or pull-request URL belongs to. */
export type ForgeKind = 'github' | 'gitlab'

export interface ForgeTarget {
  readonly kind: ForgeKind
  readonly host: string
  /** The forge's own project path: `owner/name` on GitHub, `group/subgroup/project` on GitLab. */
  readonly project: string
}

export interface ForgePullRequestTarget extends ForgeTarget {
  readonly number: number
  readonly url: string
}

/** A repository path is either bare (`owner/name`) or host-qualified (`gitlab.com/group/project`). */
export const repositorySchema = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_.-]+(?:\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+){0,3}$/u),
  Schema.isMaxLength(512),
)

const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/u
const GITLAB_URL = /^https:\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)\/((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)\/-\/merge_requests\/([1-9]\d*)\/?$/u
/** GitHub logins and repository names carry no dot in the owner, so a dotted first segment names a forge host. */
const HOST_PREFIX = /^([A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{1,5})?)\/(.+)$/u

const forgeOfHost = (host: string): ForgeKind | undefined => {
  const name = host.split(':')[0]?.toLowerCase() ?? ''
  if (name === 'github.com') return 'github'
  // GitHub Enterprise is unsupported (gh calls assume github.com); refuse it rather than hand it to glab.
  if (name.length === 0 || name.includes('github')) return undefined
  return 'gitlab'
}

/** The forge and project a URL names, or undefined when it is not an https pull/merge-request URL of a supported forge. */
const parseForgePullRequestUrl = (url: string): ForgePullRequestTarget | undefined => {
  const github = GITHUB_URL.exec(url)
  if (github !== null) {
    const [, owner, repository, numberText] = github
    if (owner === undefined || repository === undefined || numberText === undefined) return undefined
    return {
      kind: 'github',
      host: 'github.com',
      project: `${owner}/${repository}`,
      number: Number(numberText),
      url: `https://github.com/${owner}/${repository}/pull/${numberText}`,
    }
  }
  const gitlab = GITLAB_URL.exec(url)
  if (gitlab === null) return undefined
  const [, host, project, numberText] = gitlab
  if (host === undefined || project === undefined || numberText === undefined) return undefined
  return { kind: 'gitlab', host, project, number: Number(numberText), url: `https://${host}/${project}/-/merge_requests/${numberText}` }
}

/**
 * Resolve a stored repository key. A dotted first segment is a forge host (`gitlab.com/group/project`); a bare
 * `owner/name` is GitHub, which is what every record written before GitLab support holds.
 */
const forgeTargetOf = (repo: string): ForgeTarget | undefined => {
  const prefixed = HOST_PREFIX.exec(repo)
  if (prefixed !== null) {
    const [, host, project] = prefixed
    if (host === undefined || project === undefined) return undefined
    const kind = forgeOfHost(host)
    if (kind === undefined) return undefined
    return { kind, host, project }
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo)) return undefined
  return { kind: 'github', host: 'github.com', project: repo }
}

/** The stored key for a repository: host-qualified except for github.com, which keeps the bare `owner/name`. */
const repositoryKeyOf = (target: ForgeTarget): string => (target.kind === 'github' ? target.project : `${target.host}/${target.project}`)

const pullRequestUrlOf = (target: ForgeTarget, number: number): string =>
  target.kind === 'github'
    ? `https://${target.host}/${target.project}/pull/${String(number)}`
    : `https://${target.host}/${target.project}/-/merge_requests/${String(number)}`

const unsupportedForgeMessage = (repo: string): string =>
  `${repo} does not name a GitHub or GitLab repository. Use a GitHub pull-request URL or a GitLab merge-request URL, or run the command in a checkout whose origin is one of those.`

/** A remote URL (`git@host:path.git`, `ssh://host/path`, `https://host/path`) as a forge target, or undefined. */
const forgeTargetOfRemoteUrl = (url: string): ForgeTarget | undefined => {
  const trimmed = url
    .trim()
    .replace(/\.git$/u, '')
    .replace(/\/+$/u, '')
  if (trimmed.length === 0) return undefined
  const scp = /^[A-Za-z0-9_.-]+@([A-Za-z0-9.-]+(?::\d{1,5})?):(.+)$/u.exec(trimmed)
  const ssh = /^ssh:\/\/(?:[A-Za-z0-9_.-]+@)?([A-Za-z0-9.-]+(?::\d{1,5})?)\/(.+)$/u.exec(trimmed)
  const https = /^https:\/\/([A-Za-z0-9.-]+(?::\d{1,5})?)\/(.+)$/u.exec(trimmed)
  const match = scp ?? ssh ?? https
  if (match === null) return undefined
  const [, host, project] = match
  if (host === undefined || project === undefined) return undefined
  const kind = forgeOfHost(host)
  if (kind === undefined || !/^(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/u.test(project)) return undefined
  return { kind, host, project }
}

/** Forge URL and repository-key rules, grouped for the monitor, the forge port and tests. */
export class ForgeModel {
  static readonly parsePullRequestUrl = parseForgePullRequestUrl
  static readonly targetOf = forgeTargetOf
  static readonly targetOfRemoteUrl = forgeTargetOfRemoteUrl
  static readonly repositoryKeyOf = repositoryKeyOf
  static readonly pullRequestUrlOf = pullRequestUrlOf
  static readonly unsupportedMessage = unsupportedForgeMessage
}
