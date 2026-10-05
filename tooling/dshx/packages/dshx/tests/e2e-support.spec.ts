import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createScratchProfile,
  isolatedHostEnvironment,
} from '../../../e2e/support/scratch-profile.js'
import {
  completeEvidenceStep,
  createEvidenceRun,
  finishEvidenceRun,
  pruneEvidenceRuns,
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

  it('gives the Host a scratch home without inheriting process credentials', () => {
    const environment = isolatedHostEnvironment('/scratch/home', '/scratch/profile', {
      PATH: '/toolchain/bin',
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
    const result = await checkClientBoot({ projectRoot: process.cwd(), profile: 'empty', port: 0 })
    expect(result.ok).toBe(false)
    expect(result.setupError).toContain('prepared isolated profileRoot')
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
      completeEvidenceStep(run, 'profile-booted')
      const manifest = await finishEvidenceRun(run, 'failed', {
        sourceRun: 'https://github.com/acme/dshfiles/actions/runs/12001',
        sourceRunMissingReason: null,
      })
      expect(manifest.frames.map(frame => frame.frameId)).toEqual(['frame-001'])
      expect(manifest.frames[0]).toMatchObject({
        stepId: 'assertion-complete',
        path: 'frames/frame-001.jpg',
        storedBytes: 3,
        viewport: { width: 1280, height: 800 },
      })
      expect(manifest.missingStepIds).toEqual(['host-cleanup'])
      expect(manifest.status).toBe('failed')
      expect(manifest.sourceRun).toBe('https://github.com/acme/dshfiles/actions/runs/12001')
      const serialized = await readFile(join(run.runDirectory, 'manifest.json'), 'utf8')
      expect(serialized).not.toContain('private title is hashed')
      expect(serialized).not.toContain('127.0.0.1')
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })

  it('accepts only safe HTTPS source run links and states when CI identity is absent', () => {
    expect(sourceRunFromEnvironment({})).toEqual({ sourceRun: null, sourceRunMissingReason: 'ci-metadata-absent' })
    expect(sourceRunFromEnvironment({
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'acme/dshfiles',
      GITHUB_RUN_ID: '12001',
    })).toEqual({ sourceRun: 'https://github.com/acme/dshfiles/actions/runs/12001', sourceRunMissingReason: null })
    expect(sourceRunFromEnvironment({
      GITHUB_SERVER_URL: 'http://github.com',
      GITHUB_REPOSITORY: 'acme/dshfiles',
      GITHUB_RUN_ID: '12001',
    })).toEqual({ sourceRun: null, sourceRunMissingReason: 'ci-metadata-invalid' })
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
    } finally {
      await rm(outputRoot, { recursive: true, force: true })
    }
  })
})
