import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, it } from 'node:test'
import { E2E_VIEWPORT, EVIDENCE_POLICY, type EvidenceManifest } from './evidence.ts'

const supportRoot = dirname(fileURLToPath(import.meta.url))
const dshxRoot = resolve(supportRoot, '../..')
const repositoryRoot = resolve(dshxRoot, '../..')
const reporterPath = resolve(supportRoot, 'evidence-reporter.ts')
const evidenceRoot = resolve(repositoryRoot, '.dsh-e2e-evidence')
const playwrightCli = createRequire(import.meta.url).resolve('@playwright/test/cli')
const fixtureParent = join(dshxRoot, 'node_modules/.cache')
const temporaryRoots: string[] = []

interface EvidenceFixtureProject {
  readonly root: string
  readonly configPath: string
  readonly suiteName: string
}

interface StoredEvidenceRun {
  readonly directory: string
  readonly manifest: EvidenceManifest
}

const makeProject = async (testSource: (suiteName: string, startedPath: string) => string): Promise<EvidenceFixtureProject> => {
  await mkdir(fixtureParent, { recursive: true })
  const root = await mkdtemp(join(fixtureParent, 'evidence-reporter-'))
  temporaryRoots.push(root)
  const testsDirectory = join(root, 'tests')
  await mkdir(testsDirectory)

  const suiteName = `evidence reporter fixture ${basename(root)}`
  const startedPath = join(root, 'started')
  const configPath = join(root, 'playwright.config.mjs')
  await writeFile(
    configPath,
    [
      "import { defineConfig } from '@playwright/test'",
      `import { chromiumLaunchOptions } from ${JSON.stringify(new URL('../../packages/dshx/dist/project/chromium-launch-options.js', import.meta.url).href)}`,
      'export default defineConfig({',
      `  testDir: ${JSON.stringify(testsDirectory)},`,
      "  testMatch: '**/reporter.spec.mjs',",
      `  reporter: [['list'], [${JSON.stringify(reporterPath)}]],`,
      `  use: { launchOptions: await chromiumLaunchOptions(), trace: 'retain-on-failure', screenshot: 'only-on-failure', viewport: ${JSON.stringify(E2E_VIEWPORT)} },`,
      '  workers: 1,',
      '})',
      '',
    ].join('\n'),
  )
  await writeFile(join(testsDirectory, 'reporter.spec.mjs'), testSource(suiteName, startedPath))

  return { root, configPath, suiteName }
}

const runProject = (project: EvidenceFixtureProject, environment: NodeJS.ProcessEnv = {}): ReturnType<typeof spawnSync> =>
  spawnSync(process.execPath, [playwrightCli, 'test', '--config', project.configPath], {
    cwd: dshxRoot,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    timeout: 45_000,
  })

const readReceipt = async (suiteName: string): Promise<StoredEvidenceRun> => {
  const entries = await readdir(evidenceRoot)
  const runDirectories = entries.filter(entry => /^\d+-[0-9a-f-]{36}$/i.test(entry))

  for (const runDirectory of runDirectories) {
    const manifestPath = join(evidenceRoot, runDirectory, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    const manifest: EvidenceManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.tests.some(test => test.titlePath.includes(suiteName))) return { directory: runDirectory, manifest }
  }

  assert.fail('the evidence reporter did not retain this fixture run')
}

const waitFor = async (condition: () => boolean, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25))
  }
  return condition()
}

after(async () => {
  await Promise.all(temporaryRoots.map(path => rm(path, { recursive: true, force: true })))
})

it('retains a real failed browser assertion with its screenshot, trace and source identity', { timeout: 60_000 }, async () => {
  const project = await makeProject(suiteName =>
    [
      "import { expect, test } from '@playwright/test'",
      `test.describe(${JSON.stringify(suiteName)}, () => {`,
      "  test('records a failed assertion', async ({ page }) => {",
      "    await test.step('visit http://127.0.0.1:3299/session?token=fixture-secret', async () => {",
      "      await page.setContent('<main>safe fixture</main>')",
      '    })',
      "    await expect(page.locator('main')).toHaveText('missing text')",
      '  })',
      '})',
      '',
    ].join('\n'),
  )

  const result = runProject(project, {
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'fixture-owner/e2e',
    GITHUB_RUN_ID: '12345',
    GITHUB_SHA: 'a'.repeat(40),
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Error in reporter/)

  const receipt = await readReceipt(project.suiteName)
  const test = receipt.manifest.tests[0]
  assert.equal(receipt.manifest.outcome, 'failed')
  assert.equal(test?.outcome, 'failed')
  assert.equal(receipt.manifest.source.revision, `git:${'a'.repeat(40)}`)
  assert.equal(receipt.manifest.source.runUrl, 'https://github.com/fixture-owner/e2e/actions/runs/12345')
  assert.ok(test?.steps.some(step => step.category === 'assertion' && step.outcome === 'failed'))
  assert.ok(test?.steps.some(step => step.title.includes('<local-session-url>')))
  assert.doesNotMatch(JSON.stringify(receipt.manifest), /fixture-secret|safe fixture/)
  assert.ok((test?.attachments.length ?? 0) >= 2)

  const attachments = test?.attachments ?? []
  assert.ok(attachments.some(attachment => attachment.kind === 'screenshot'))
  assert.ok(attachments.some(attachment => attachment.kind === 'trace'))
  const attachmentBytes = attachments.reduce((total, attachment) => total + attachment.sizeBytes, 0)
  assert.ok(attachmentBytes <= EVIDENCE_POLICY.maxRunAttachmentBytes)
  for (const attachment of attachments) {
    const contents = await readFile(join(evidenceRoot, receipt.directory, attachment.file))
    assert.equal(contents.byteLength, attachment.sizeBytes)
    assert.equal(createHash('sha256').update(contents).digest('hex'), attachment.sha256)
  }
})

it('records a real interrupted browser run as cancelled', { timeout: 60_000 }, async () => {
  const project = await makeProject((suiteName, startedPath) =>
    [
      "import { test } from '@playwright/test'",
      "import { writeFile } from 'node:fs/promises'",
      `test.describe(${JSON.stringify(suiteName)}, () => {`,
      "  test('waits for interruption', async ({ page }) => {",
      "    await page.setContent('<main>safe fixture</main>')",
      `    await writeFile(${JSON.stringify(startedPath)}, 'started')`,
      '    await new Promise(resolveDelay => setTimeout(resolveDelay, 60_000))',
      '  })',
      '})',
      '',
    ].join('\n'),
  )

  // Keep cancellation evidence independent of local JJ availability and CI's ambient revision.
  const sourceSha = 'b'.repeat(40)
  const child = spawn(process.execPath, [playwrightCli, 'test', '--config', project.configPath], {
    cwd: dshxRoot,
    env: { ...process.env, GITHUB_SHA: sourceSha },
    stdio: 'ignore',
  })
  const closed = new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>(resolveClose => {
    child.once('close', (code, signal) => resolveClose({ code, signal }))
  })
  const started = await waitFor(() => existsSync(join(project.root, 'started')), 20_000)
  if (!started) {
    child.kill('SIGKILL')
    await closed
    assert.fail('the browser fixture did not start')
  }

  child.kill('SIGINT')
  const result = await Promise.race([closed, new Promise<null>(resolveTimeout => setTimeout(() => resolveTimeout(null), 15_000))])
  if (result === null) {
    child.kill('SIGKILL')
    await closed
    assert.fail('the interrupted Playwright runner did not stop')
  }
  assert.ok(result.signal !== null || (result.code ?? 0) !== 0)

  const receipt = await readReceipt(project.suiteName)
  assert.equal(receipt.manifest.outcome, 'cancelled')
  assert.equal(receipt.manifest.tests[0]?.outcome, 'cancelled')
  assert.match(receipt.manifest.source.revision ?? '', /^(jj|git):/)
  assert.equal(receipt.manifest.source.revision, `git:${sourceSha}`)
})
