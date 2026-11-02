import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import * as Schema from 'effect/Schema'

const githubReleaseSchema = Schema.Struct({
  tag_name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  name: Schema.NullOr(Schema.String.check(Schema.isMaxLength(255))),
  published_at: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))),
  draft: Schema.Boolean,
  body: Schema.NullOr(Schema.String.check(Schema.isMaxLength(50_000))),
})

const releaseHighlightSchema = Schema.Struct({
  section: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)),
})

const releaseInfoSchema = Schema.Struct({
  version: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  url: Schema.String.check(Schema.isMaxLength(2_048), Schema.isPattern(/^https:\/\/github\.com\//u)),
  publishedAt: Schema.NullOr(Schema.String.check(Schema.isMaxLength(40))),
  highlights: Schema.Array(releaseHighlightSchema).check(Schema.isMaxLength(12)),
})

export const dshReleaseStatusSchema = Schema.Struct({
  currentVersion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
  latestVersion: Schema.NullOr(Schema.String.check(Schema.isMaxLength(100))),
  latestUrl: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2_048), Schema.isPattern(/^https:\/\/github\.com\//u))),
  available: Schema.Boolean,
  comparisonKnown: Schema.Boolean,
  releases: Schema.Array(releaseInfoSchema).check(Schema.isMaxLength(100)),
})

export type ReleaseInfo = typeof releaseInfoSchema.Type
export type DshReleaseStatus = typeof dshReleaseStatusSchema.Type

const RELEASES_URL = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100'
const RELEASE_PAGE_URL = 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/'
const RESPONSE_LIMIT_BYTES = 1_000_000
const RELEASE_VERSION_PATTERN = /^(?:dsh-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/u

const releaseVersion = (tag: string): string | undefined => RELEASE_VERSION_PATTERN.exec(tag)?.[1]

const plainText = (value: string): string =>
  value
    .replace(/<[^>]*>/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/\*\*|__/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()

const summarizeReleaseNotes = (body: string | null): ReleaseInfo['highlights'] => {
  if (body === null) return []
  let englishSection = true
  let section = 'Changes'
  const highlights: ReleaseInfo['highlights'][number][] = []
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim()
    const htmlHeading = /^<h[1-6]\b([^>]*)>(.*?)<\/h[1-6]>$/iu.exec(line)
    if (htmlHeading !== null) {
      const id = /\bid=["']([^"']+)["']/iu.exec(htmlHeading[1] ?? '')?.[1] ?? ''
      const title = plainText(htmlHeading[2] ?? '')
      englishSection = id.startsWith('en-') || /\benglish\b/iu.test(title)
      if (englishSection && title.length > 0) section = title.slice(0, 80)
      continue
    }
    const markdownHeading = /^#{1,4}\s+(.+?)\s*#*$/u.exec(line)
    if (markdownHeading !== null) {
      const title = plainText(markdownHeading[1] ?? '')
      if (/^(中文|简体中文|chinese)$/iu.test(title)) englishSection = false
      else if (/^english$/iu.test(title)) englishSection = true
      else if (englishSection) section = title.slice(0, 80) || 'Changes'
      continue
    }
    if (!englishSection) continue
    const bullet = /^[-*]\s+(.+)$/u.exec(line)?.[1]
    if (bullet === undefined) continue
    const text = plainText(bullet.replace(/\s+(?:by|@)\s+@?[A-Za-z0-9_-]+(?:\s*,\s*@?[A-Za-z0-9_-]+)*\.?$/u, ''))
    if (text.length === 0) continue
    highlights.push({ section, text: text.slice(0, 300) })
    if (highlights.length === 12) return highlights
  }
  return highlights
}

const versionedRelease = (release: typeof githubReleaseSchema.Type): ReleaseInfo | undefined => {
  const version = releaseVersion(release.tag_name)
  if (version === undefined || release.draft) return undefined
  return {
    version,
    title: release.name ?? `v${version}`,
    url: `${RELEASE_PAGE_URL}${encodeURIComponent(release.tag_name)}`,
    publishedAt: release.published_at,
    highlights: summarizeReleaseNotes(release.body),
  }
}

export const releaseStatusFromGitHub = (input: { readonly currentVersion: string | null; readonly response: unknown }): DshReleaseStatus => {
  const payload = Schema.decodeUnknownSync(Schema.Array(githubReleaseSchema).check(Schema.isMaxLength(100)))(input.response)
  const releases = payload.flatMap((release): ReleaseInfo[] => {
    const parsed = versionedRelease(release)
    return parsed === undefined ? [] : [parsed]
  })
  const latest = releases[0]
  const currentIndex = input.currentVersion === null ? -1 : releases.findIndex(release => release.version === input.currentVersion)
  const comparisonKnown = currentIndex >= 0
  return {
    currentVersion: input.currentVersion,
    latestVersion: latest?.version ?? null,
    latestUrl: latest?.url ?? null,
    available: currentIndex > 0,
    comparisonKnown,
    releases: currentIndex > 0 ? releases.slice(0, currentIndex) : [],
  }
}

export const fetchDshReleaseStatus = async (input: {
  readonly currentVersion: string | null
  readonly fetch: typeof globalThis.fetch
  readonly signal: AbortSignal
}): Promise<DshReleaseStatus> => {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10_000)])
  const response = await input.fetch(RELEASES_URL, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'dshfiles-settings-shell' },
    redirect: 'error',
    signal,
  })
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}.`)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > RESPONSE_LIMIT_BYTES) throw new Error('GitHub Releases response exceeded the size limit.')
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('GitHub Releases returned an empty response.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > RESPONSE_LIMIT_BYTES) {
        await reader.cancel()
        throw new Error('GitHub Releases response exceeded the size limit.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return releaseStatusFromGitHub({ currentVersion: input.currentVersion, response: decodeJson(jsonValueSchema, new TextDecoder().decode(bytes)) })
}
