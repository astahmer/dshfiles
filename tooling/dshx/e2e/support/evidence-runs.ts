import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { z } from 'zod'

const MAX_FRAME_BYTES = 512 * 1024
const MAX_FRAMES = 8
const MAX_RETAINED_RUNS = 10
const MAX_RETAINED_BYTES = 20 * 1024 * 1024
const stepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const frameSchema = z.object({
  frameId: z.string().regex(/^frame-[0-9]{3}$/),
  stepId: stepIdSchema,
  capturedAt: z.string().datetime(),
  viewport: z.object({ width: z.number().int().min(0), height: z.number().int().min(0) }).strict(),
  path: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  storedBytes: z.number().int().min(0).max(MAX_FRAME_BYTES),
  missingReason: z.enum(['capture-failed', 'frame-too-large', 'frame-limit']).nullable(),
}).strict().superRefine((frame, context) => {
  const hasFile = frame.path !== null && frame.sha256 !== null && frame.storedBytes > 0 && frame.missingReason === null
  const hasMissingReason = frame.path === null && frame.sha256 === null && frame.storedBytes === 0 && frame.missingReason !== null
  if (!hasFile && !hasMissingReason) context.addIssue({ code: 'custom', message: 'frame file metadata is inconsistent' })
  if (frame.path !== null && frame.path !== `frames/${frame.frameId}.jpg`) {
    context.addIssue({ code: 'custom', message: 'frame path is outside its owned frame directory' })
  }
})
const evidenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.literal('dshx-e2e'),
  runId: z.string().regex(/^run-[0-9a-f-]{36}$/),
  suiteId: z.enum(['client-plugin-boot', 'isolated-plugin-boot']),
  scenarioDigest: z.string().regex(/^[0-9a-f]{16}$/),
  createdAt: z.string().datetime(),
  sourceRun: z.string().url().nullable(),
  sourceRunMissingReason: z.enum(['ci-metadata-absent', 'ci-metadata-invalid']).nullable(),
  status: z.enum(['passed', 'failed', 'interrupted', 'partial']),
  expectedStepIds: z.array(stepIdSchema),
  completedStepIds: z.array(stepIdSchema),
  missingStepIds: z.array(stepIdSchema),
  frames: z.array(frameSchema).max(MAX_FRAMES + 1),
}).strict().superRefine((manifest, context) => {
  const expected = new Set(manifest.expectedStepIds)
  const completed = new Set(manifest.completedStepIds)
  const missing = new Set(manifest.missingStepIds)
  if (expected.size !== manifest.expectedStepIds.length || completed.size !== manifest.completedStepIds.length) {
    context.addIssue({ code: 'custom', message: 'step ids must be unique' })
  }
  if (manifest.completedStepIds.some(stepId => !expected.has(stepId))) {
    context.addIssue({ code: 'custom', message: 'completed steps must be expected' })
  }
  if (manifest.missingStepIds.some(stepId => !expected.has(stepId) || completed.has(stepId))) {
    context.addIssue({ code: 'custom', message: 'missing steps must be expected and incomplete' })
  }
  if (expected.size !== completed.size + missing.size) {
    context.addIssue({ code: 'custom', message: 'every expected step must be completed or missing' })
  }
  if (manifest.frames.some((frame, index) => frame.frameId !== `frame-${String(index + 1).padStart(3, '0')}`)) {
    context.addIssue({ code: 'custom', message: 'frames must use unique ordered ids' })
  }
  if (missing.size !== manifest.missingStepIds.length || manifest.sourceRun === null && manifest.sourceRunMissingReason === null) {
    context.addIssue({ code: 'custom', message: 'missing steps and source identity must be explicit' })
  }
  if (manifest.sourceRun !== null && manifest.sourceRunMissingReason !== null) {
    context.addIssue({ code: 'custom', message: 'a present source run cannot have a missing reason' })
  }
  if ((manifest.status === 'passed' && missing.size > 0) || (manifest.status === 'partial' && missing.size === 0)) {
    context.addIssue({ code: 'custom', message: 'status must reflect missing expected coverage' })
  }
  if (manifest.sourceRun !== null) {
    const source = new URL(manifest.sourceRun)
    if (source.protocol !== 'https:' || source.username !== '' || source.password !== '' || source.search !== '' || source.hash !== '') {
      context.addIssue({ code: 'custom', message: 'source run links must be credential-free HTTPS URLs' })
    }
  }
})

export type EvidenceStatus = 'passed' | 'failed' | 'interrupted' | 'partial'
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>

export interface EvidenceRun {
  readonly runId: string
  readonly suiteId: EvidenceManifest['suiteId']
  readonly scenarioDigest: string
  readonly createdAt: string
  readonly expectedStepIds: readonly string[]
  readonly outputRoot: string
  readonly runDirectory: string
  readonly completedStepIds: Set<string>
  readonly frames: EvidenceManifest['frames']
}

export interface SourceRunLink {
  readonly sourceRun: string | null
  readonly sourceRunMissingReason: EvidenceManifest['sourceRunMissingReason']
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const defaultOutputRoot = join(workspaceRoot, 'tooling/dshx/output/e2e-evidence')

const sourceRunSchema = z.object({
  server: z.string().url(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  runId: z.string().regex(/^[0-9]+$/),
})

export const sourceRunFromEnvironment = (environment: NodeJS.ProcessEnv = process.env): SourceRunLink => {
  const raw = {
    server: environment.GITHUB_SERVER_URL,
    repository: environment.GITHUB_REPOSITORY,
    runId: environment.GITHUB_RUN_ID,
  }
  if (Object.values(raw).every(value => value === undefined || value === '')) {
    return { sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' }
  }
  const parsed = sourceRunSchema.safeParse(raw)
  if (!parsed.success) return { sourceRun: null, sourceRunMissingReason: 'ci-metadata-invalid' }

  const server = new URL(parsed.data.server)
  if (server.protocol !== 'https:' || server.username !== '' || server.password !== '' || server.search !== '' || server.hash !== '') {
    return { sourceRun: null, sourceRunMissingReason: 'ci-metadata-invalid' }
  }
  const serverPath = server.pathname.replace(/\/$/, '')
  const sourceRun = `${server.origin}${serverPath}/${parsed.data.repository}/actions/runs/${parsed.data.runId}`
  return { sourceRun, sourceRunMissingReason: null }
}

export const createEvidenceRun = async (options: {
  readonly suiteId: EvidenceManifest['suiteId']
  readonly scenarioPath: readonly string[]
  readonly expectedStepIds: readonly string[]
  readonly outputRoot?: string
}): Promise<EvidenceRun> => {
  const expectedStepIds = z.array(stepIdSchema).superRefine((steps, context) => {
    if (new Set(steps).size !== steps.length) context.addIssue({ code: 'custom', message: 'step ids must be unique' })
  }).safeParse(options.expectedStepIds)
  if (!expectedStepIds.success) throw new Error('The evidence step list contains an invalid static step id.')
  const outputRoot = resolve(options.outputRoot ?? defaultOutputRoot)
  const runId = `run-${randomUUID()}`
  const runDirectory = join(outputRoot, runId)
  await mkdir(runDirectory, { recursive: true })
  return {
    runId,
    suiteId: options.suiteId,
    scenarioDigest: createHash('sha256').update(options.scenarioPath.join('\u0000')).digest('hex').slice(0, 16),
    createdAt: new Date().toISOString(),
    expectedStepIds: expectedStepIds.data,
    outputRoot,
    runDirectory,
    completedStepIds: new Set(),
    frames: [],
  }
}

export const completeEvidenceStep = (run: EvidenceRun, stepId: string): void => {
  const parsed = stepIdSchema.safeParse(stepId)
  if (!parsed.success) throw new Error('The evidence step id is not a valid static id.')
  if (run.expectedStepIds.includes(stepId)) run.completedStepIds.add(stepId)
}

const frameMetadata = (
  run: EvidenceRun,
  stepId: string,
  viewport: { readonly width: number; readonly height: number },
  missingReason: 'capture-failed' | 'frame-too-large' | 'frame-limit',
) => ({
  frameId: `frame-${String(run.frames.length + 1).padStart(3, '0')}`,
  stepId,
  capturedAt: new Date().toISOString(),
  viewport,
  path: null,
  sha256: null,
  storedBytes: 0,
  missingReason,
})

export const storeEvidenceFrame = async (
  run: EvidenceRun,
  stepId: string,
  bytes: Uint8Array | undefined,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> => {
  const parsedStepId = stepIdSchema.safeParse(stepId)
  if (!parsedStepId.success) throw new Error('The evidence frame step id is not a valid static id.')
  if (run.expectedStepIds.includes(stepId)) completeEvidenceStep(run, stepId)

  if (run.frames.length > MAX_FRAMES) return
  if (run.frames.length === MAX_FRAMES) {
    run.frames.push(frameMetadata(run, stepId, viewport, 'frame-limit'))
    return
  }
  if (bytes === undefined || bytes.byteLength === 0) {
    run.frames.push(frameMetadata(run, stepId, viewport, 'capture-failed'))
    return
  }
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    run.frames.push(frameMetadata(run, stepId, viewport, 'frame-too-large'))
    return
  }

  const frameId = `frame-${String(run.frames.length + 1).padStart(3, '0')}`
  const relativePath = `frames/${frameId}.jpg`
  const absolutePath = resolve(run.runDirectory, relativePath)
  await mkdir(dirname(absolutePath), { recursive: true })
  const buffer = Buffer.from(bytes)
  await writeFile(absolutePath, buffer, { flag: 'wx' })
  run.frames.push({
    frameId,
    stepId,
    capturedAt: new Date().toISOString(),
    viewport,
    path: relativePath,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    storedBytes: buffer.byteLength,
    missingReason: null,
  })
}

export const capturePageEvidenceFrame = async (run: EvidenceRun, page: Page, stepId: string): Promise<void> => {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 60, animations: 'disabled' }).catch(() => undefined)
  await storeEvidenceFrame(run, stepId, screenshot, viewport)
}

const ownedRunBytes = async (directory: string, manifest: EvidenceManifest): Promise<number | undefined> => {
  const rootEntries = await readdir(directory, { withFileTypes: true })
  if (rootEntries.some(entry => entry.isSymbolicLink() || !['manifest.json', 'frames'].includes(entry.name))) return undefined
  if (!rootEntries.some(entry => entry.name === 'manifest.json' && entry.isFile())) return undefined
  const frameRoot = rootEntries.find(entry => entry.name === 'frames')
  if (frameRoot !== undefined && !frameRoot.isDirectory()) return undefined
  const manifestPath = join(directory, 'manifest.json')
  const manifestInfo = await lstat(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) return undefined
  const manifestBytes = manifestInfo.size
  const frameDirectory = join(directory, 'frames')
  const frameEntries = await readdir(frameDirectory, { withFileTypes: true }).catch(() => [])
  const expectedFrames = manifest.frames.flatMap(frame => frame.path === null ? [] : [frame.path.slice('frames/'.length)])
  if (frameEntries.length !== expectedFrames.length) return undefined
  if (frameEntries.some(entry => entry.isSymbolicLink() || !entry.isFile() || !expectedFrames.includes(entry.name))) return undefined
  const frameBytes = await Promise.all(
    frameEntries.map(async entry => {
      const path = join(frameDirectory, entry.name)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) return undefined
      const expected = manifest.frames.find(frame => frame.path === `frames/${entry.name}`)
      if (expected === undefined || info.size !== expected.storedBytes) return undefined
      const bytes = await readFile(path)
      if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) return undefined
      return info.size
    }),
  )
  if (frameBytes.some(size => size === undefined)) return undefined
  return manifestBytes + frameBytes.reduce<number>((total, size) => total + (size ?? 0), 0)
}

export const pruneEvidenceRuns = async (outputRoot: string): Promise<void> => {
  const rootStats = await lstat(outputRoot).catch(() => undefined)
  if (rootStats === undefined || !rootStats.isDirectory() || rootStats.isSymbolicLink()) return
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(() => [])
  const validRuns = await Promise.all(
    entries.flatMap(entry => {
      if (!entry.isDirectory() || !/^run-[0-9a-f-]{36}$/.test(entry.name)) return []
      return [async () => {
        const directory = join(outputRoot, entry.name)
        const manifestPath = join(directory, 'manifest.json')
        const manifestInfo = await lstat(manifestPath).catch(() => undefined)
        if (manifestInfo === undefined || !manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) {
          return undefined
        }
        const source = await readFile(manifestPath, 'utf8').catch(() => undefined)
        if (source === undefined) return undefined
        let data: unknown
        try {
          data = JSON.parse(source)
        } catch {
          return undefined
        }
        const parsed = evidenceManifestSchema.safeParse(data)
        if (!parsed.success || parsed.data.runId !== entry.name) return undefined
        const bytes = await ownedRunBytes(directory, parsed.data)
        if (bytes === undefined) return undefined
        return { directory, createdAt: parsed.data.createdAt, bytes }
      }]
    }).map(async load => await load()),
  )
  const ordered = validRuns.filter((run): run is NonNullable<typeof run> => run !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  let retainedCount = 0
  let retainedBytes = 0
  for (const run of ordered) {
    if (retainedCount >= MAX_RETAINED_RUNS || retainedBytes + run.bytes > MAX_RETAINED_BYTES) {
      const details = await lstat(run.directory).catch(() => undefined)
      if (details !== undefined && details.isDirectory() && !details.isSymbolicLink()) await rm(run.directory, { recursive: true, force: true })
      continue
    }
    retainedCount += 1
    retainedBytes += run.bytes
  }
}

export const finishEvidenceRun = async (
  run: EvidenceRun,
  status: EvidenceStatus,
  sourceRunLink: SourceRunLink = sourceRunFromEnvironment(),
): Promise<EvidenceManifest> => {
  const expectedStepIds = [...run.expectedStepIds]
  const completedStepIds = expectedStepIds.filter(stepId => run.completedStepIds.has(stepId))
  const missingStepIds = expectedStepIds.filter(stepId => !run.completedStepIds.has(stepId))
  const manifest = evidenceManifestSchema.parse({
    schemaVersion: 1,
    owner: 'dshx-e2e',
    runId: run.runId,
    suiteId: run.suiteId,
    scenarioDigest: run.scenarioDigest,
    createdAt: run.createdAt,
    sourceRun: sourceRunLink.sourceRun,
    sourceRunMissingReason: sourceRunLink.sourceRunMissingReason,
    status: status === 'passed' && missingStepIds.length > 0 ? 'partial' : status,
    expectedStepIds,
    completedStepIds,
    missingStepIds,
    frames: run.frames,
  })
  const temporaryPath = join(run.runDirectory, 'manifest.json.tmp')
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  await rename(temporaryPath, join(run.runDirectory, 'manifest.json'))
  await pruneEvidenceRuns(run.outputRoot)
  return manifest
}
