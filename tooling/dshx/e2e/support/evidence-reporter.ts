import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, basename, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter'
import {
  E2E_VIEWPORT,
  type EvidenceAttachmentCandidate,
  type EvidenceManifest,
  type EvidenceOutcome,
  type EvidenceStep,
  type EvidenceTest,
  persistEvidenceRun,
} from './evidence.js'

const dshxRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const repositoryRoot = resolve(dshxRoot, '../..')
const evidenceRoot = resolve(repositoryRoot, '.dsh-e2e-evidence')
const MAX_RECORDED_STEPS_PER_TEST = 500
const MAX_STEP_TITLE_LENGTH = 240

const testOutcome = (status: TestResult['status']): EvidenceOutcome => {
  if (status === 'passed') return 'passed'
  if (status === 'interrupted' || status === 'skipped') return 'cancelled'
  return 'failed'
}

const runOutcome = (status: FullResult['status']): EvidenceOutcome => {
  if (status === 'passed') return 'passed'
  if (status === 'interrupted') return 'cancelled'
  return 'failed'
}

const safeStepTitle = (title: string): string =>
  title
    .replace(/https?:\/\/127\.0\.0\.1:\d+\/\S+/g, '<local-session-url>')
    .replace(/([?&](?:token|key|secret)=)[^\s&]+/gi, '$1<redacted>')
    .slice(0, MAX_STEP_TITLE_LENGTH)

const relativeTestFile = (file: string): string => {
  const candidate = relative(repositoryRoot, file)
  if (isAbsolute(candidate) || candidate === '..' || candidate.startsWith('../')) return basename(file)
  return candidate.replaceAll('\\', '/')
}

const identityFor = (file: string, line: number, titles: readonly string[], retry: number): string =>
  createHash('sha256')
    .update(JSON.stringify([file, line, titles, retry]))
    .digest('hex')
    .slice(0, 24)

const sourceRevision = (): string | null => {
  const commitFromCi = process.env.GITHUB_SHA
  if (commitFromCi !== undefined && /^[0-9a-f]{40,64}$/i.test(commitFromCi)) return `git:${commitFromCi}`

  try {
    const changeId = execFileSync('jj', ['log', '-r', '@', '--no-graph', '-T', 'change_id.short()'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim()
    return changeId.length > 0 ? `jj:${changeId}` : null
  } catch {
    return null
  }
}

const sourceRunUrl = (): string | null => {
  const server = process.env.GITHUB_SERVER_URL
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server === undefined || repository === undefined || runId === undefined) return null

  try {
    const base = new URL(server.endsWith('/') ? server : `${server}/`)
    if (base.protocol !== 'https:' && base.protocol !== 'http:') return null
    if (base.username.length > 0 || base.password.length > 0) return null
    const [owner, name, ...extra] = repository.split('/')
    if (owner === undefined || name === undefined || extra.length > 0) return null
    const path = [owner, name, 'actions', 'runs', runId].map(encodeURIComponent).join('/')
    return new URL(path, base).toString()
  } catch {
    return null
  }
}

const collectSteps = (steps: readonly TestStep[], startedAt: Date): readonly EvidenceStep[] => {
  const recorded: EvidenceStep[] = []
  const visit = (candidates: readonly TestStep[], parentSequence: number | null): void => {
    for (const step of candidates) {
      let nextParent = parentSequence
      if (step.category === 'test.step' || step.category === 'expect') {
        if (recorded.length >= MAX_RECORDED_STEPS_PER_TEST) return
        const sequence = recorded.length + 1
        recorded.push({
          sequence,
          parentSequence,
          title: safeStepTitle(step.title),
          category: step.category === 'expect' ? 'assertion' : 'action',
          outcome: step.error === undefined ? 'passed' : 'failed',
          offsetMs: Math.max(0, step.startTime.getTime() - startedAt.getTime()),
          durationMs: Math.max(0, step.duration),
        })
        nextParent = sequence
      }
      visit(step.steps, nextParent)
      if (recorded.length >= MAX_RECORDED_STEPS_PER_TEST) return
    }
  }
  visit(steps, null)
  return recorded
}

const evidenceTest = (test: TestCase, result: TestResult): EvidenceTest => {
  const titlePath = test.titlePath().map(safeStepTitle)
  const file = relativeTestFile(test.location.file)
  const key = identityFor(file, test.location.line, titlePath, result.retry)
  return {
    key,
    titlePath,
    file,
    line: test.location.line,
    expectedStatus: test.expectedStatus,
    outcome: testOutcome(result.status),
    durationMs: Math.max(0, result.duration),
    retry: result.retry,
    steps: collectSteps(result.steps, result.startTime),
    attachments: [],
  }
}

const attachmentCandidates = (testKey: string, result: TestResult): readonly EvidenceAttachmentCandidate[] =>
  result.attachments.map(attachment => ({
    testKey,
    name: attachment.name,
    contentType: attachment.contentType,
    ...(attachment.path === undefined ? {} : { path: attachment.path }),
    ...(attachment.body === undefined ? {} : { body: attachment.body }),
  }))

export default class EvidenceReporter implements Reporter {
  private runId: string | null = null
  private startedAt: Date | null = null
  private revision: string | null = null
  private readonly tests = new Map<string, EvidenceTest>()
  private readonly attachments: EvidenceAttachmentCandidate[] = []

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.runId = randomUUID()
    this.startedAt = new Date()
    this.revision = sourceRevision()
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const receipt = evidenceTest(test, result)
    this.tests.set(receipt.key, receipt)
    this.attachments.push(...attachmentCandidates(receipt.key, result))
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | void> {
    if (this.runId === null || this.startedAt === null) return

    const completedAt = new Date()
    const manifest: EvidenceManifest = {
      schemaVersion: 1,
      runId: this.runId,
      startedAt: this.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: runOutcome(result.status),
      source: {
        revision: this.revision,
        runUrl: sourceRunUrl(),
      },
      browser: {
        engine: 'chromium',
        viewport: E2E_VIEWPORT,
        actionIdentity: 'ordered Playwright test steps',
        frameIdentity: 'test-scoped; trace retains internal frame order',
        frameAlignment: 'trace-only; no synthetic action-to-frame mapping',
      },
      tests: [...this.tests.values()],
    }

    try {
      await persistEvidenceRun(evidenceRoot, manifest, this.attachments)
      return
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      process.stderr.write(`dshx E2E evidence could not be retained (${errorName}).\n`)
      return { status: 'failed' }
    }
  }

  printsToStdio(): boolean {
    return false
  }
}
