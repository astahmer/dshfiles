import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { z } from 'zod'

const MAX_FRAME_BYTES = 512 * 1024
const MAX_FRAMES = 8
const MAX_REPORT_BYTES = 64 * 1024
const MAX_CATALOG_BYTES = 16 * 1024
const MAX_EXPECTED_STEPS = 64
const MAX_ASSERTIONS = 64
const MAX_RETAINED_RUNS = 10
const MAX_RETAINED_BYTES = 20 * 1024 * 1024
const stepIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const assertionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
const evidenceAssertionSchema = z
  .object({ assertionId: assertionIdSchema, outcome: z.enum(['passed', 'failed']) })
  .strict()
const frameSchema = z
  .object({
    frameId: z.string().regex(/^frame-[0-9]{3}$/),
    stepId: stepIdSchema,
    capturedAt: z.string().datetime(),
    viewport: z.object({ width: z.number().int().min(0), height: z.number().int().min(0) }).strict(),
    path: z.string().nullable(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    storedBytes: z.number().int().min(0).max(MAX_FRAME_BYTES),
    missingReason: z.enum(['capture-failed', 'frame-too-large', 'frame-limit']).nullable(),
  })
  .strict()
  .superRefine((frame, context) => {
    const hasFile = frame.path !== null && frame.sha256 !== null && frame.storedBytes > 0 && frame.missingReason === null
    const hasMissingReason = frame.path === null && frame.sha256 === null && frame.storedBytes === 0 && frame.missingReason !== null
    if (!hasFile && !hasMissingReason) context.addIssue({ code: 'custom', message: 'frame file metadata is inconsistent' })
    if (frame.path !== null && frame.path !== `frames/${frame.frameId}.jpg`) {
      context.addIssue({ code: 'custom', message: 'frame path is outside its owned frame directory' })
    }
  })
const evidenceManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    owner: z.literal('dshx-e2e'),
    runId: z.string().regex(/^run-[0-9a-f-]{36}$/),
    suiteId: z.literal('client-plugin-boot'),
    scenarioDigest: z.string().regex(/^[0-9a-f]{16}$/),
    createdAt: z.string().datetime(),
    sourceRun: z.string().url().nullable(),
    sourceRunMissingReason: z.enum(['ci-metadata-absent', 'ci-metadata-invalid']).nullable(),
    status: z.enum(['passed', 'failed', 'interrupted', 'partial', 'skipped']),
    expectedStepIds: z.array(stepIdSchema).max(MAX_EXPECTED_STEPS),
    completedStepIds: z.array(stepIdSchema),
    missingStepIds: z.array(stepIdSchema),
    assertions: z.array(evidenceAssertionSchema).max(MAX_ASSERTIONS).default([]),
    frames: z.array(frameSchema).max(MAX_FRAMES + 1),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expected = new Set(manifest.expectedStepIds)
    const completed = new Set(manifest.completedStepIds)
    const missing = new Set(manifest.missingStepIds)
    const assertionIds = manifest.assertions.map(assertion => assertion.assertionId)
    if (expected.size !== manifest.expectedStepIds.length || completed.size !== manifest.completedStepIds.length) {
      context.addIssue({ code: 'custom', message: 'step ids must be unique' })
    }
    if (new Set(assertionIds).size !== assertionIds.length) {
      context.addIssue({ code: 'custom', message: 'assertion ids must be unique' })
    }
    if (manifest.status === 'passed' && manifest.assertions.some(assertion => assertion.outcome === 'failed')) {
      context.addIssue({ code: 'custom', message: 'a passed run cannot contain a failed assertion' })
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
    if (missing.size !== manifest.missingStepIds.length || (manifest.sourceRun === null && manifest.sourceRunMissingReason === null)) {
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

export type EvidenceStatus = 'passed' | 'failed' | 'interrupted' | 'partial' | 'skipped'
export type EvidenceManifest = z.infer<typeof evidenceManifestSchema>
export type EvidenceAssertion = EvidenceManifest['assertions'][number]

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, character => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })

const renderEvidenceCatalog = (manifests: readonly EvidenceManifest[]): string => {
  const rows = manifests
    .map(
      manifest =>
        `<tr><td><a href="../${escapeHtml(manifest.runId)}/report.html"><code>${escapeHtml(manifest.runId)}</code></a></td><td>${escapeHtml(manifest.createdAt)}</td><td>${escapeHtml(manifest.suiteId)}</td><td class="status">${escapeHtml(manifest.status)}</td><td>${manifest.completedStepIds.length}/${manifest.expectedStepIds.length}</td><td>${manifest.missingStepIds.length}</td></tr>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>DSHX retained E2E evidence</title>
<style>
:root{color-scheme:light dark;font:14px/1.5 system-ui,sans-serif}body{max-width:1100px;margin:32px auto;padding:0 20px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}.status{text-transform:uppercase;font-weight:700}code{overflow-wrap:anywhere}
</style>
</head>
<body><h1>Retained DSHX E2E evidence</h1><p>Use your browser's find command to search retained runs. Run rows link to their bounded screenshot timeline.</p><table><thead><tr><th>Run</th><th>Created</th><th>Suite</th><th>Status</th><th>Recorded steps</th><th>Missing steps</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No retained runs.</td></tr>'}</tbody></table></body>
</html>\n`
}

const writeEvidenceCatalog = async (outputRoot: string, manifests: readonly EvidenceManifest[]): Promise<void> => {
  const catalogDirectory = join(outputRoot, 'catalog')
  const catalogStats = await lstat(catalogDirectory).catch(() => undefined)
  if (catalogStats === undefined) await mkdir(catalogDirectory).catch(() => undefined)
  const currentCatalogStats = await lstat(catalogDirectory).catch(() => undefined)
  if (currentCatalogStats === undefined || !currentCatalogStats.isDirectory() || currentCatalogStats.isSymbolicLink()) return

  const ownerPath = join(catalogDirectory, '.dshx-e2e-owner')
  const ownerStats = await lstat(ownerPath).catch(() => undefined)
  if (ownerStats !== undefined && (!ownerStats.isFile() || ownerStats.isSymbolicLink() || ownerStats.size > 64)) return
  if (ownerStats === undefined) {
    const contents = await readdir(catalogDirectory).catch(() => ['unreadable'])
    if (contents.length > 0) return
    await writeFile(ownerPath, 'dshx-e2e-catalog-v1\n', { flag: 'wx' }).catch(() => undefined)
  }
  const ownerContents = await readFile(ownerPath, 'utf8').catch(() => '')
  if (ownerContents !== 'dshx-e2e-catalog-v1\n') return

  const indexPath = join(catalogDirectory, 'index.html')
  const indexStats = await lstat(indexPath).catch(() => undefined)
  if (indexStats !== undefined && (!indexStats.isFile() || indexStats.isSymbolicLink())) return
  const html = renderEvidenceCatalog(manifests)
  if (Buffer.byteLength(html) > MAX_CATALOG_BYTES) throw new Error('The retained E2E evidence catalog exceeded its size limit.')
  const temporaryPath = join(catalogDirectory, `index-${randomUUID()}.tmp`)
  await writeFile(temporaryPath, html, { flag: 'wx' })
  await rename(temporaryPath, indexPath)
}

export const renderEvidenceReport = (manifest: EvidenceManifest): string => {
  const completed = new Set(manifest.completedStepIds)
  const sourceIdentity =
    manifest.sourceRun === null
      ? `Source run unavailable: ${escapeHtml(manifest.sourceRunMissingReason ?? 'unknown')}`
      : `Source run: <code>${escapeHtml(manifest.sourceRun)}</code>`
  const steps = manifest.expectedStepIds
    .map(stepId => {
      const recorded = completed.has(stepId)
      return `<li><span class="step-state ${recorded ? 'recorded' : 'missing'}">${recorded ? 'Recorded' : 'Missing'}</span><code>${escapeHtml(stepId)}</code></li>`
    })
    .join('\n')
  const assertions =
    manifest.assertions.length === 0
      ? '<p>No individual assertion results were recorded for this run.</p>'
      : `<ol class="assertions">${manifest.assertions
          .map(assertion => `<li><span class="assertion-state ${assertion.outcome}">${assertion.outcome}</span><code>${escapeHtml(assertion.assertionId)}</code></li>`)
          .join('\n')}</ol>`
  const frames = manifest.frames
    .map((frame, index) => {
      const label = escapeHtml(frame.stepId)
      const image =
        frame.path === null
          ? `<p class="missing">Frame unavailable: ${escapeHtml(frame.missingReason ?? 'unknown')}</p>`
          : `<img src="./${escapeHtml(frame.path)}" alt="Screenshot for ${label}" loading="lazy">`
      const previous = manifest.frames[index - 1]
      const next = manifest.frames[index + 1]
      const previousControl =
        previous === undefined
          ? '<span aria-disabled="true">Previous frame</span>'
          : `<a rel="prev" href="#${escapeHtml(previous.frameId)}">Previous frame</a>`
      const nextControl =
        next === undefined
          ? '<span aria-disabled="true">Next frame</span>'
          : `<a rel="next" href="#${escapeHtml(next.frameId)}">Next frame</a>`
      const controls = `<nav class="frame-controls" aria-label="Screenshot replay controls">${previousControl}<span>Frame ${String(index + 1)} of ${String(manifest.frames.length)}</span>${nextControl}</nav>`
      return `<figure id="${escapeHtml(frame.frameId)}"><figcaption><strong>${escapeHtml(frame.frameId)}</strong> · ${label} · ${escapeHtml(frame.capturedAt)}</figcaption>${controls}${image}</figure>`
    })
    .join('\n')
  const timeline = manifest.frames
    .map((frame, index) => `<li><a href="#${escapeHtml(frame.frameId)}"><code>${escapeHtml(frame.frameId)}</code> · ${escapeHtml(frame.stepId)} (${String(index + 1)} of ${String(manifest.frames.length)})</a></li>`)
    .join('\n')
  const replayStart = manifest.frames.length === 0 ? '' : '<p><a class="replay-start" href="#frame-001">Start screenshot replay</a></p>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
<title>DSHX E2E ${escapeHtml(manifest.runId)}</title>
<style>
:root{color-scheme:light dark;font:14px/1.5 system-ui,sans-serif}body{max-width:1000px;margin:32px auto;padding:0 20px}header,section{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;padding:16px;margin:16px 0}h1,h2,p{margin-top:0}.summary{display:flex;flex-wrap:wrap;gap:12px}.status{font-weight:700;text-transform:uppercase}.steps,.assertions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;padding:0;list-style:none}.steps li,.assertions li{display:flex;align-items:center;gap:8px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:8px;padding:8px}.step-state,.assertion-state{font-size:11px;text-transform:uppercase}.recorded,.passed{color:#188a55}.missing,.failed{color:#bd4c37}.frame-controls{display:flex;justify-content:space-between;gap:12px;margin:12px 0}.frame-controls a,.replay-start{display:inline-block;border:1px solid color-mix(in srgb,currentColor 24%,transparent);border-radius:6px;padding:6px 10px}figure{display:none;margin:18px 0;padding-bottom:18px;border-bottom:1px solid color-mix(in srgb,currentColor 14%,transparent);scroll-margin-top:16px}figure:target{display:block}figcaption{margin-bottom:8px}img{display:block;max-width:100%;height:auto;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:8px}code{overflow-wrap:anywhere}
</style>
</head>
<body>
<header><h1>DSHX E2E evidence</h1><div class="summary"><span class="status">${escapeHtml(manifest.status)}</span><span>${escapeHtml(manifest.suiteId)}</span><time datetime="${escapeHtml(manifest.createdAt)}">${escapeHtml(manifest.createdAt)}</time></div><p>Run <code>${escapeHtml(manifest.runId)}</code> · scenario digest <code>${escapeHtml(manifest.scenarioDigest)}</code></p><p>${sourceIdentity}</p></header>
<section><h2>Expected steps</h2><p>Recorded means the harness reached that step. Missing steps are not counted as covered.</p><ul class="steps">${steps}</ul></section>
<section><h2>Assertion results</h2><p>Only static assertion ids and pass/fail outcomes are stored; failure text and page content are excluded.</p>${assertions}</section>
<section><h2>Screenshot timeline replay</h2><p>Step through screenshots in capture order. This replays stored frames only; it does not reconstruct browser state or infer missing coverage.</p>${replayStart}${timeline.length > 0 ? `<nav aria-label="Screenshot timeline"><ol>${timeline}</ol></nav>` : ''}${frames || '<p>No screenshots were retained for this run.</p>'}</section>
</body>
</html>\n`
}

export interface EvidenceRun {
  readonly runId: string
  readonly suiteId: EvidenceManifest['suiteId']
  readonly scenarioDigest: string
  readonly createdAt: string
  readonly expectedStepIds: readonly string[]
  readonly outputRoot: string
  readonly runDirectory: string
  readonly completedStepIds: Set<string>
  readonly assertions: EvidenceManifest['assertions']
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
  const expectedStepIds = z
    .array(stepIdSchema)
    .max(MAX_EXPECTED_STEPS)
    .superRefine((steps, context) => {
      if (new Set(steps).size !== steps.length) context.addIssue({ code: 'custom', message: 'step ids must be unique' })
    })
    .safeParse(options.expectedStepIds)
  if (!expectedStepIds.success) throw new Error('The evidence step list must contain at most 64 unique static step ids.')
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
    assertions: [],
    frames: [],
  }
}

export const completeEvidenceStep = (run: EvidenceRun, stepId: string): void => {
  const parsed = stepIdSchema.safeParse(stepId)
  if (!parsed.success) throw new Error('The evidence step id is not a valid static id.')
  if (run.expectedStepIds.includes(stepId)) run.completedStepIds.add(stepId)
}

export const recordEvidenceAssertion = (
  run: EvidenceRun,
  assertionId: string,
  outcome: EvidenceAssertion['outcome'],
): void => {
  const assertion = evidenceAssertionSchema.safeParse({ assertionId, outcome })
  if (!assertion.success) throw new Error('The evidence assertion must use a static id and a pass/fail outcome.')
  if (run.assertions.length >= MAX_ASSERTIONS) throw new Error('The E2E evidence run exceeded its assertion limit.')
  if (run.assertions.some(recorded => recorded.assertionId === assertionId)) {
    throw new Error('The evidence assertion id must be unique within a run.')
  }
  run.assertions.push(assertion.data)
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
  if (rootEntries.some(entry => entry.isSymbolicLink() || !['manifest.json', 'frames', 'report.html'].includes(entry.name))) return undefined
  if (!rootEntries.some(entry => entry.name === 'manifest.json' && entry.isFile())) return undefined
  const frameRoot = rootEntries.find(entry => entry.name === 'frames')
  if (frameRoot !== undefined && !frameRoot.isDirectory()) return undefined
  const manifestPath = join(directory, 'manifest.json')
  const manifestInfo = await lstat(manifestPath)
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > 64 * 1024) return undefined
  const manifestBytes = manifestInfo.size
  const frameDirectory = join(directory, 'frames')
  const frameEntries = await readdir(frameDirectory, { withFileTypes: true }).catch(() => [])
  const expectedFrames = manifest.frames.flatMap(frame => (frame.path === null ? [] : [frame.path.slice('frames/'.length)]))
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
  const reportEntry = rootEntries.find(entry => entry.name === 'report.html')
  let reportBytes = 0
  if (reportEntry !== undefined) {
    const reportPath = join(directory, 'report.html')
    const reportInfo = await lstat(reportPath)
    if (!reportInfo.isFile() || reportInfo.isSymbolicLink() || reportInfo.size > MAX_REPORT_BYTES) return undefined
    const report = await readFile(reportPath, 'utf8')
    if (report !== renderEvidenceReport(manifest)) return undefined
    reportBytes = reportInfo.size
  }
  return manifestBytes + reportBytes + frameBytes.reduce<number>((total, size) => total + (size ?? 0), 0)
}

export const pruneEvidenceRuns = async (outputRoot: string): Promise<void> => {
  const rootStats = await lstat(outputRoot).catch(() => undefined)
  if (rootStats === undefined || !rootStats.isDirectory() || rootStats.isSymbolicLink()) return
  const entries = await readdir(outputRoot, { withFileTypes: true }).catch(() => [])
  const validRuns = await Promise.all(
    entries
      .flatMap(entry => {
        if (!entry.isDirectory() || !/^run-[0-9a-f-]{36}$/.test(entry.name)) return []
        return [
          async () => {
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
            return { directory, createdAt: parsed.data.createdAt, bytes, manifest: parsed.data }
          },
        ]
      })
      .map(async load => await load()),
  )
  const ordered = validRuns
    .filter((run): run is NonNullable<typeof run> => run !== undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  let retainedCount = 0
  let retainedBytes = 0
  const retainedManifests: EvidenceManifest[] = []
  for (const run of ordered) {
    if (retainedCount >= MAX_RETAINED_RUNS || retainedBytes + run.bytes > MAX_RETAINED_BYTES) {
      const details = await lstat(run.directory).catch(() => undefined)
      if (details !== undefined && details.isDirectory() && !details.isSymbolicLink()) await rm(run.directory, { recursive: true, force: true })
      continue
    }
    retainedCount += 1
    retainedBytes += run.bytes
    retainedManifests.push(run.manifest)
  }
  await writeEvidenceCatalog(outputRoot, retainedManifests)
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
    assertions: run.assertions,
    frames: run.frames,
  })
  const temporaryPath = join(run.runDirectory, 'manifest.json.tmp')
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  await rename(temporaryPath, join(run.runDirectory, 'manifest.json'))
  const report = renderEvidenceReport(manifest)
  if (Buffer.byteLength(report) > MAX_REPORT_BYTES) throw new Error('The E2E evidence report exceeded its size limit.')
  await writeFile(join(run.runDirectory, 'report.html'), report, { flag: 'wx' })
  await pruneEvidenceRuns(run.outputRoot)
  return manifest
}
