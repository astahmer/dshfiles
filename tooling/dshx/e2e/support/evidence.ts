import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const E2E_VIEWPORT = Object.freeze({ width: 1280, height: 800 })

export const EVIDENCE_POLICY = Object.freeze({
  maxRuns: 20,
  maxTotalBytes: 128 * 1024 * 1024,
  maxAttachmentBytes: 8 * 1024 * 1024,
  maxRunAttachmentBytes: 12 * 1024 * 1024,
  maxManifestBytes: 512 * 1024,
})

export type EvidenceOutcome = 'passed' | 'failed' | 'cancelled'

export interface EvidenceStep {
  readonly sequence: number
  readonly parentSequence: number | null
  readonly title: string
  readonly category: 'action' | 'assertion'
  readonly outcome: 'passed' | 'failed'
  readonly offsetMs: number
  readonly durationMs: number
}

export interface EvidenceAttachmentReference {
  readonly sequence: number
  readonly name: string
  readonly kind: 'screenshot' | 'trace' | 'diagnostics'
  readonly contentType: string
  readonly file: string
  readonly sizeBytes: number
  readonly sha256: string
}

export interface EvidenceTest {
  readonly key: string
  readonly titlePath: readonly string[]
  readonly file: string
  readonly line: number
  readonly expectedStatus: string
  readonly outcome: EvidenceOutcome
  readonly durationMs: number
  readonly retry: number
  readonly steps: readonly EvidenceStep[]
  readonly attachments: readonly EvidenceAttachmentReference[]
}

export interface EvidenceManifest {
  readonly schemaVersion: 1
  readonly runId: string
  readonly startedAt: string
  readonly completedAt: string
  readonly outcome: EvidenceOutcome
  readonly source: {
    readonly revision: string | null
    readonly runUrl: string | null
  }
  readonly browser: {
    readonly engine: 'chromium'
    readonly viewport: typeof E2E_VIEWPORT
    readonly actionIdentity: 'ordered Playwright test steps'
    readonly frameIdentity: 'test-scoped; trace retains internal frame order'
    readonly frameAlignment: 'trace-only; no synthetic action-to-frame mapping'
  }
  readonly tests: readonly EvidenceTest[]
}

export interface EvidenceAttachmentCandidate {
  readonly testKey: string
  readonly name: string
  readonly contentType: string
  readonly path?: string
  readonly body?: Buffer
}

export interface EvidencePolicy {
  readonly maxRuns: number
  readonly maxTotalBytes: number
  readonly maxAttachmentBytes: number
  readonly maxRunAttachmentBytes: number
  readonly maxManifestBytes: number
}

const RUN_DIRECTORY_PATTERN = /^\d+-[0-9a-f-]{36}$/i
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * What the harness retains from a run: Playwright's screenshot and trace, plus the failure diagnostics a journey
 * attaches (host output, browser console, API traffic). Diagnostics used to be dropped for want of an entry here, so a
 * flaky failure kept no evidence beyond its screenshot.
 */
const ATTACHMENT_FORMATS: Readonly<Record<string, { readonly extension: string; readonly kind: EvidenceAttachmentReference['kind'] }>> = {
  'image/png': { extension: '.png', kind: 'screenshot' },
  'image/jpeg': { extension: '.jpg', kind: 'screenshot' },
  'application/zip': { extension: '.zip', kind: 'trace' },
  'application/json': { extension: '.json', kind: 'diagnostics' },
}
const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set(Object.keys(ATTACHMENT_FORMATS))
const MAX_MEASURED_FILES = 10_000

const validatePolicy = (policy: EvidencePolicy): void => {
  if (
    policy.maxRuns < 1 ||
    policy.maxAttachmentBytes < 1 ||
    policy.maxRunAttachmentBytes < policy.maxAttachmentBytes ||
    policy.maxManifestBytes < 1 ||
    policy.maxTotalBytes < policy.maxRunAttachmentBytes + policy.maxManifestBytes
  ) {
    throw new Error('evidence retention limits are inconsistent')
  }
}

const safeArtifactName = (name: string): string => {
  const normalized = name
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72)
  return normalized.replace(/^[-.]+|[-.]+$/g, '') || 'artifact'
}

const readAttachment = async (candidate: EvidenceAttachmentCandidate, policy: EvidencePolicy): Promise<Buffer | undefined> => {
  if (!ALLOWED_CONTENT_TYPES.has(candidate.contentType)) return undefined
  if (candidate.body !== undefined) {
    return candidate.body.byteLength <= policy.maxAttachmentBytes ? candidate.body : undefined
  }
  if (candidate.path === undefined) return undefined

  try {
    const details = await lstat(candidate.path)
    if (!details.isFile() || details.isSymbolicLink() || details.size > policy.maxAttachmentBytes) return undefined
    const contents = await readFile(candidate.path)
    return contents.byteLength <= policy.maxAttachmentBytes ? contents : undefined
  } catch {
    return undefined
  }
}

const directorySize = async (directory: string): Promise<number> => {
  const pending = [directory]
  let bytes = 0
  let measuredFiles = 0

  while (pending.length > 0 && measuredFiles < MAX_MEASURED_FILES) {
    const current = pending.pop()
    if (current === undefined) continue
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (!entry.isFile()) continue
      const details = await lstat(entryPath)
      bytes += details.size
      measuredFiles += 1
      if (measuredFiles >= MAX_MEASURED_FILES) break
    }
  }

  return bytes
}

const pruneEvidenceRuns = async (root: string, protectedRun: string, policy: EvidencePolicy): Promise<void> => {
  const entries = await readdir(root, { withFileTypes: true })
  const candidates: Array<{ name: string; path: string; size: number; modifiedAt: number }> = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !RUN_DIRECTORY_PATTERN.test(entry.name)) continue
    const path = join(root, entry.name)
    const details = await lstat(path)
    if (!details.isDirectory() || details.isSymbolicLink()) continue
    candidates.push({ name: entry.name, path, size: await directorySize(path), modifiedAt: details.mtimeMs })
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name))
  let retainedRuns = 0
  let retainedBytes = 0

  for (const candidate of candidates) {
    const isProtected = candidate.name === protectedRun
    const fits = retainedRuns < policy.maxRuns && retainedBytes + candidate.size <= policy.maxTotalBytes
    if (isProtected || fits) {
      retainedRuns += 1
      retainedBytes += candidate.size
      continue
    }
    await rm(candidate.path, { recursive: true, force: true })
  }
}

export const persistEvidenceRun = async (
  evidenceRoot: string,
  manifest: EvidenceManifest,
  attachments: readonly EvidenceAttachmentCandidate[],
  policy: EvidencePolicy = EVIDENCE_POLICY,
): Promise<{ readonly manifest: EvidenceManifest; readonly directory: string }> => {
  validatePolicy(policy)
  if (!RUN_ID_PATTERN.test(manifest.runId)) throw new Error('evidence run id is invalid')

  const root = resolve(evidenceRoot)
  await mkdir(root, { recursive: true })
  const rootDetails = await lstat(root)
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) throw new Error('evidence root must be a real directory')
  await pruneEvidenceRuns(root, '', policy)

  const runDirectoryName = `${Date.now()}-${manifest.runId}`
  const finalDirectory = join(root, runDirectoryName)
  const validTestKeys = new Set(manifest.tests.map(test => test.key))
  const referencesByTest = new Map<string, EvidenceAttachmentReference[]>()
  let totalAttachmentBytes = 0
  let persistedSequence = 0
  let published = false

  await mkdir(finalDirectory)
  await mkdir(join(finalDirectory, 'attachments'))

  try {
    for (const candidate of attachments) {
      if (!validTestKeys.has(candidate.testKey) || totalAttachmentBytes >= policy.maxRunAttachmentBytes) continue
      const contents = await readAttachment(candidate, policy)
      if (contents === undefined || totalAttachmentBytes + contents.byteLength > policy.maxRunAttachmentBytes) continue

      const format = ATTACHMENT_FORMATS[candidate.contentType]
      if (format === undefined) continue
      persistedSequence += 1
      const fileName = `${String(persistedSequence).padStart(3, '0')}-${safeArtifactName(candidate.name)}${format.extension}`
      const relativeFile = `attachments/${fileName}`
      const filePath = join(finalDirectory, relativeFile)
      await writeFile(filePath, contents, { flag: 'wx' })
      totalAttachmentBytes += contents.byteLength
      const reference: EvidenceAttachmentReference = {
        sequence: persistedSequence,
        name: safeArtifactName(candidate.name),
        kind: format.kind,
        contentType: candidate.contentType,
        file: relativeFile,
        sizeBytes: contents.byteLength,
        sha256: createHash('sha256').update(contents).digest('hex'),
      }
      const current = referencesByTest.get(candidate.testKey) ?? []
      referencesByTest.set(candidate.testKey, [...current, reference])
    }

    const storedManifest: EvidenceManifest = {
      ...manifest,
      tests: manifest.tests.map(test => ({
        ...test,
        attachments: referencesByTest.get(test.key) ?? [],
      })),
    }
    const serializedManifest = `${JSON.stringify(storedManifest, null, 2)}\n`
    if (Buffer.byteLength(serializedManifest, 'utf8') > policy.maxManifestBytes) {
      throw new Error('evidence manifest exceeds the configured size limit')
    }

    const temporaryManifest = join(finalDirectory, 'manifest.json.tmp')
    await writeFile(temporaryManifest, serializedManifest, { flag: 'wx' })
    await rename(temporaryManifest, join(finalDirectory, 'manifest.json'))
    published = true
    await pruneEvidenceRuns(root, runDirectoryName, policy)
    return { manifest: storedManifest, directory: finalDirectory }
  } finally {
    if (!published) await rm(finalDirectory, { recursive: true, force: true })
  }
}
