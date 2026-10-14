import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScratchProfile, isolatedHostEnvironment } from '../../../e2e/support/scratch-profile.js'
import {
  completeEvidenceStep,
  createEvidenceRun,
  finishEvidenceRun,
  pruneEvidenceRuns,
  recordEvidenceAssertion,
  renderEvidenceReport,
  sourceRunFromEnvironment,
  storeEvidenceFrame,
} from '../../../e2e/support/evidence-runs.js'
import { checkClientBoot } from '../src/project/client-boot-check.js'

describe('E2E scratch profile provisioning', () => {
  it('copies only profile dependencies and resolves local links against the source profile', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'dshx-source-profile-'))
    const target = join(sourceRoot, 'target-plugin')
    const sourcePatch = join(sourceRoot, 'cordis.patch.yml')
    let scratch: Awaited<ReturnType<typeof createScratchProfile>> | undefined
    try {
      await mkdir(target)
      await writeFile(join(target, 'package.json'), JSON.stringify({ name: '@dshfiles/sample' }))
      await writeFile(sourcePatch, 'private patch data')
      await writeFile(
        join(sourceRoot, 'package.json'),
        JSON.stringify({
          name: 'private-profile-name',
          private: true,
          dependencies: {
            '@dshfiles/sample': 'link:./target-plugin',
            '@deepseek-ai/dsh-base': '0.2.0-rc.2',
          },
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dshfiles/sample'] } },
          privateData: 'must not be copied',
        }),
      )
      scratch = await createScratchProfile({ profileName: 'sample', sourceProfileRoot: sourceRoot })
      const manifest: unknown = JSON.parse(await readFile(join(scratch.profileRoot, 'package.json'), 'utf8'))
      expect(manifest).toMatchObject({
        name: 'dshx-e2e-sample',
        dependencies: {
          '@dshfiles/sample': `link:${target}`,
          '@deepseek-ai/dsh-base': '0.2.0-rc.2',
        },
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dshfiles/sample'] } },
      })
      expect(manifest).not.toHaveProperty('privateData')
      await expect(readFile(join(scratch.profileRoot, 'cordis.patch.yml'), 'utf8')).rejects.toThrow()
      expect(await readFile(join(scratch.profileRoot, 'pnpm-workspace.yaml'), 'utf8')).toContain('allowBuilds:')
    } finally {
      await scratch?.cleanup()
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it('leaves out a URL dependency that an explicit bundle list never loads, and still refuses a requested one', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'dshx-source-profile-'))
    let scratch: Awaited<ReturnType<typeof createScratchProfile>> | undefined
    try {
      await writeFile(
        join(sourceRoot, 'package.json'),
        JSON.stringify({
          dependencies: { '@deepseek-ai/dsh-base': '0.2.0-rc.2', 'github-plugin': 'github:owner/github-plugin#abc123' },
        }),
      )
      scratch = await createScratchProfile({ profileName: 'sample', sourceProfileRoot: sourceRoot, bundleIds: ['@deepseek-ai/dsh-base'] })
      const manifest = await readFile(join(scratch.profileRoot, 'package.json'), 'utf8')
      expect(manifest).toContain('"@deepseek-ai/dsh-base": "0.2.0-rc.2"')
      expect(manifest).not.toContain('github-plugin')
      await expect(createScratchProfile({ profileName: 'sample', sourceProfileRoot: sourceRoot, bundleIds: ['github-plugin'] })).rejects.toThrow(
        'The github-plugin dependency uses a URL or unsupported protocol in the isolated profile.',
      )
    } finally {
      await scratch?.cleanup()
      await rm(sourceRoot, { recursive: true, force: true })
    }
  })

  it('gives the Host a scratch home without inheriting process credentials', () => {
    const environment = isolatedHostEnvironment('/scratch/home', '/scratch/profile', {
      PATH: '/repo/plugins/@dshfiles/sample/node_modules/.bin:/repo/node_modules/.bin:/toolchain/bin',
      HOME: '/real/home',
      DSH_HOME: '/real/dsh',
      OPENAI_API_KEY: 'never copied',
      GH_TOKEN: 'never copied',
    })
    expect(environment).toMatchObject({
      PATH: '/toolchain/bin',
      HOME: '/scratch/home',
      DSH_HOME: '/scratch/home',
      DSHX_BOOT_PROFILE_ROOT: '/scratch/profile',
      XDG_CONFIG_HOME: '/scratch/home/config',
    })
    expect(environment.OPENAI_API_KEY).toBeUndefined()
    expect(environment.GH_TOKEN).toBeUndefined()
  })

  it('refuses to treat an unprepared empty profile as a client boot pass', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dshx-unprepared-home-'))
    const result = await checkClientBoot({
      projectRoot: process.cwd(),
      profile: 'empty',
      port: 0,
      dshHome,
      profileRoot: join(dshHome, 'unprepared'),
      expectedBundles: ['@dshfiles/unprepared'],
      expectedClientEntries: [],
    })
    await rm(dshHome, { recursive: true, force: true })
    expect(result.ok).toBe(false)
    expect(result.processError).toContain('prepared isolated profileRoot')
  })
})

describe('bounded E2E evidence', () => {
  it('records source identity, ordered screenshots and missing step coverage', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-'))
    try {
      const run = await createEvidenceRun({
        suiteId: 'client-plugin-boot',
        scenarioPath: ['private title is hashed'],
        expectedStepIds: ['profile-booted', 'assertion-complete', 'host-cleanup'],
        outputRoot,
      })
      await storeEvidenceFrame(run, 'assertion-complete', new Uint8Array([1, 2, 3]), { width: 1280, height: 800 })
      await storeEvidenceFrame(run, 'final-state', new Uint8Array([4, 5, 6]), { width: 1280, height: 800 })
      completeEvidenceStep(run, 'profile-booted')
      recordEvidenceAssertion(run, 'client-entry-activation', 'passed')
      recordEvidenceAssertion(run, 'slot-mount', 'failed')
      expect(() => recordEvidenceAssertion(run, 'slot-mount', 'passed')).toThrow('unique')
      const manifest = await finishEvidenceRun(run, 'failed', {
        sourceRun: 'https://github.com/acme/dshfiles/actions/runs/12001',
        sourceRunMissingReason: null,
      })
      expect(manifest.frames.map(frame => frame.frameId)).toEqual(['frame-001', 'frame-002'])
      expect(manifest.frames[0]).toMatchObject({
        stepId: 'assertion-complete',
        path: 'frames/frame-001.jpg',
        storedBytes: 3,
        viewport: { width: 1280, height: 800 },
      })
      expect(manifest.missingStepIds).toEqual(['host-cleanup'])
      expect(manifest.status).toBe('failed')
      expect(manifest.assertions).toEqual([
        { assertionId: 'client-entry-activation', outcome: 'passed' },
        { assertionId: 'slot-mount', outcome: 'failed' },
      ])
      expect(manifest.sourceRun).toBe('https://github.com/acme/dshfiles/actions/runs/12001')
      const serialized = await readFile(join(run.runDirectory, 'manifest.json'), 'utf8')
      const report = await readFile(join(run.runDirectory, 'report.html'), 'utf8')
      expect(serialized).not.toContain('private title is hashed')
      expect(serialized).not.toContain('127.0.0.1')
      expect(report).toContain('Screenshot timeline replay')
      expect(report).toContain('Start screenshot replay')
      expect(report).toContain('href="#frame-002"')
      expect(report).toContain('Previous frame')
      expect(report).toContain('Next frame')
      expect(report).toContain('Assertion results')
      expect(report).toContain('client-entry-activation')
      expect(report).toContain('slot-mount')
      expect(report).toContain('./frames/frame-001.jpg')
      expect(report).toContain('./frames/frame-002.jpg')
      expect(report).toContain('failed')
      expect(report).toContain('assertion-complete')
      expect(report).toContain('host-cleanup')
      expect(report).toContain('https://github.com/acme/dshfiles/actions/runs/12001')
      expect(report).not.toContain('private title is hashed')
      expect(report).not.toContain('127.0.0.1')
      expect(report).not.toContain('<script')
      expect(renderEvidenceReport(manifest)).toBe(report)
      const catalog = await readFile(join(outputRoot, 'catalog/index.html'), 'utf8')
      expect(catalog).toContain(manifest.runId)
      expect(catalog).toContain('failed')
      expect(catalog).toContain('../')
      expect(catalog).not.toContain('<script')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('keeps skipped runs distinct and leaves expected coverage missing', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-skipped-'))
    try {
      const run = await createEvidenceRun({
        suiteId: 'client-plugin-boot',
        scenarioPath: ['skipped scenario'],
        expectedStepIds: ['assertion-complete'],
        outputRoot,
      })
      const manifest = await finishEvidenceRun(run, 'skipped', {
        sourceRun: null,
        sourceRunMissingReason: 'ci-metadata-absent',
      })
      expect(manifest.status).toBe('skipped')
      expect(manifest.missingStepIds).toEqual(['assertion-complete'])
      await expect(readFile(join(run.runDirectory, 'report.html'), 'utf8')).resolves.toContain('skipped')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('records interrupted runs distinctly and leaves unfinished steps missing', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-interrupted-'))
    try {
      const run = await createEvidenceRun({
        suiteId: 'client-plugin-boot',
        scenarioPath: ['interrupted scenario'],
        expectedStepIds: ['profile-booted', 'assertion-complete'],
        outputRoot,
      })
      const manifest = await finishEvidenceRun(run, 'interrupted', {
        sourceRun: null,
        sourceRunMissingReason: 'ci-metadata-absent',
      })

      expect(manifest.status).toBe('interrupted')
      expect(manifest.missingStepIds).toEqual(['profile-booted', 'assertion-complete'])
      await expect(readFile(join(run.runDirectory, 'report.html'), 'utf8')).resolves.toContain('interrupted')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('keeps prior version 1 manifests without assertion receipts valid for retention', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-legacy-'))
    try {
      const run = await createEvidenceRun({
        suiteId: 'client-plugin-boot',
        scenarioPath: ['legacy manifest'],
        expectedStepIds: [],
        outputRoot,
      })
      await finishEvidenceRun(run, 'passed', { sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' })
      const manifestPath = join(run.runDirectory, 'manifest.json')
      const legacyManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      delete legacyManifest.assertions
      await writeFile(manifestPath, `${JSON.stringify(legacyManifest)}\n`)

      await pruneEvidenceRuns(outputRoot)

      await expect(readFile(manifestPath, 'utf8')).resolves.toContain('dshx-e2e')
      await expect(readFile(join(outputRoot, 'catalog/index.html'), 'utf8')).resolves.toContain(run.runId)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('rejects a passed run with a failed assertion receipt', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-assertion-status-'))
    try {
      const run = await createEvidenceRun({
        suiteId: 'client-plugin-boot',
        scenarioPath: ['failed assertion'],
        expectedStepIds: [],
        outputRoot,
      })
      recordEvidenceAssertion(run, 'plugin-activation', 'failed')

      await expect(finishEvidenceRun(run, 'passed', { sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' })).rejects.toThrow(
        'a passed run cannot contain a failed assertion',
      )
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('accepts only safe HTTPS source run links and states when CI identity is absent', () => {
    expect(sourceRunFromEnvironment({})).toEqual({ sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' })
    expect(
      sourceRunFromEnvironment({
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/dshfiles',
        GITHUB_RUN_ID: '12001',
      }),
    ).toEqual({ sourceRun: 'https://github.com/acme/dshfiles/actions/runs/12001', sourceRunMissingReason: null })
    expect(
      sourceRunFromEnvironment({
        GITHUB_SERVER_URL: 'http://github.com',
        GITHUB_REPOSITORY: 'acme/dshfiles',
        GITHUB_RUN_ID: '12001',
      }),
    ).toEqual({ sourceRun: null, sourceRunMissingReason: 'ci-metadata-invalid' })
  })

  it('prunes only complete DSH-owned run directories', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'dshx-evidence-retention-'))
    const malformedRun = join(outputRoot, 'run-12345678-1234-1234-1234-123456789abc')
    try {
      await mkdir(malformedRun)
      await writeFile(join(malformedRun, 'manifest.json'), '{not valid json')
      await writeFile(join(malformedRun, 'user-file.txt'), 'preserve')
      const createdRuns: string[] = []
      for (let index = 0; index < 11; index += 1) {
        const run = await createEvidenceRun({
          suiteId: 'client-plugin-boot',
          scenarioPath: [`scenario-${String(index)}`],
          expectedStepIds: [],
          outputRoot,
        })
        createdRuns.push(run.runDirectory)
        await finishEvidenceRun(run, 'passed', { sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' })
      }
      await pruneEvidenceRuns(outputRoot)
      await expect(readFile(join(malformedRun, 'user-file.txt'), 'utf8')).resolves.toBe('preserve')
      await expect(readFile(join(createdRuns[0] ?? '', 'manifest.json'), 'utf8')).rejects.toThrow()
      await expect(readFile(join(createdRuns.at(-1) ?? '', 'manifest.json'), 'utf8')).resolves.toContain('dshx-e2e')
      await expect(readFile(join(createdRuns.at(-1) ?? '', 'report.html'), 'utf8')).resolves.toContain('DSHX E2E evidence')
      const catalog = await readFile(join(outputRoot, 'catalog/index.html'), 'utf8')
      expect(catalog).toContain(createdRuns.at(-1)?.split('/').at(-1) ?? '')
      expect(catalog).not.toContain(createdRuns[0]?.split('/').at(-1) ?? '')
      expect(catalog.match(/<tr><td/g)).toHaveLength(10)
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })
})
