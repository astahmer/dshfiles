import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as preparation from '../../packages/dshx/src/project/boot-profile.js'
import { LocalBundleModel } from '../../packages/dshx/src/project/local-bundles.js'
import * as composition from '../../packages/dshx/src/project/profile-composition.js'
import * as processes from '../../packages/dshx/src/project/owned-process.js'
import { bootComposedPluginProfile, bootPluginProfile, closePrewarmedProfiles, prewarmSibling, type BootedProfile } from './boot.js'
import { seedAiAccountsWorkspace } from './ai-accounts-workspace.js'

vi.mock('../../scripts/reap-scratch-processes.mjs', () => ({ recordScratchProcess: vi.fn(), scratchLedgerPath: () => '/unused' }))
vi.mock('../../packages/dshx/src/project/boot-profile.js', () => ({ prepareComposedBootProfile: vi.fn() }))

const roots: string[] = []
const profiles: BootedProfile[] = []
const packageIds = ['@test/plugin', '@dshfiles/ai-accounts'] as const
const request = { packageIds: ['@test/plugin'] as const, profileLabel: 'seed-test' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('DSHX_E2E_PREBUILT', '1')
  vi.stubEnv('DSHX_E2E_PREWARM', '1')
  // Provisioning is the seam: exercise the actual seed, storage, prewarm and process lifecycle without installing a profile per assertion.
  vi.spyOn(LocalBundleModel, 'listLocalBootBundles').mockResolvedValue(
    packageIds.map(packageId => ({ packageId, projectRoot: '/unused', hasClient: false, clientExternalPackages: [], usesPluginUi: false })),
  )
  vi.spyOn(preparation, 'prepareComposedBootProfile').mockImplementation(async bundles => {
    const homeRoot = await mkdtemp(join(tmpdir(), 'dshx-boot-seed-'))
    roots.push(homeRoot)
    const profileRoot = join(homeRoot, 'profile')
    await mkdir(profileRoot)
    await Promise.all(['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'].map(name => writeFile(join(profileRoot, name), '{}')))
    return {
      homeRoot,
      profileRoot,
      profile: 'test',
      expectedBundles: [bundles[0].packageId],
      dispose: async () => rm(homeRoot, { recursive: true, force: true }),
    }
  })
  vi.spyOn(composition, 'readProfileComposition').mockResolvedValue(packageIds.join('\n'))
  const spawn = processes.spawnOwnedProcess
  vi.spyOn(processes, 'spawnOwnedProcess').mockImplementation((_executable, _args, options) =>
    spawn(process.execPath, ['-e', "console.log('http://127.0.0.1:31999/test'); setInterval(() => {}, 1000)"], options),
  )
})

afterEach(async () => {
  await closePrewarmedProfiles()
  await Promise.all(profiles.splice(0).map(profile => profile.close()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

type SeedOptions = Pick<Parameters<typeof bootComposedPluginProfile>[0], 'seedHome' | 'seedKey'>

const boot = async (seed: SeedOptions = {}): Promise<BootedProfile> => {
  const profile = await bootComposedPluginProfile({ ...request, ...seed })
  profiles.push(profile)
  return profile
}

describe('deterministic boot seeds', () => {
  it('rejects missing recipes and empty stable keys before provisioning or launching', async () => {
    for (const seedKey of ['', '  ', '\n']) {
      await expect(boot({ seedHome: async () => undefined, seedKey })).rejects.toThrow('seedKey requires a deterministic seedHome')
    }
    await expect(boot({ seedKey: 'workspace-v1' })).rejects.toThrow('seedKey requires a deterministic seedHome')
    expect(preparation.prepareComposedBootProfile).not.toHaveBeenCalled()
    expect(processes.spawnOwnedProcess).not.toHaveBeenCalled()
  })

  it('prewarms a keyed recipe in a separate seeded home and consumes that sibling', async () => {
    const seed = vi.fn(seedAiAccountsWorkspace)
    const first = await boot({ seedHome: seed, seedKey: 'workspace-v1' })
    prewarmSibling(first)
    const sibling = await boot({ seedHome: seed, seedKey: 'workspace-v1' })
    expect(preparation.prepareComposedBootProfile).toHaveBeenCalledTimes(2)
    expect(seed.mock.calls.map(([home]) => home)).toEqual([first.homeRoot, sibling.homeRoot])
    expect(sibling.homeRoot).not.toBe(first.homeRoot)
    for (const profile of [first, sibling]) {
      expect(await readFile(join(profile.homeRoot, 'storages/workspace.json'), 'utf8')).toContain(join(profile.homeRoot, 'ai-accounts-project'))
    }
  })

  it('does not reuse a sibling with a different recipe key', async () => {
    const firstSeed = vi.fn(seedAiAccountsWorkspace)
    const secondSeed = vi.fn(seedAiAccountsWorkspace)
    const first = await boot({ seedHome: firstSeed, seedKey: 'workspace-v1' })
    prewarmSibling(first)
    const second = await boot({ seedHome: secondSeed, seedKey: 'workspace-v2' })
    expect(secondSeed).toHaveBeenCalledExactlyOnceWith(second.homeRoot)
    const sibling = await boot({ seedHome: firstSeed, seedKey: 'workspace-v1' })
    expect(sibling.homeRoot).not.toBe(second.homeRoot)
    expect(preparation.prepareComposedBootProfile).toHaveBeenCalledTimes(3)
  })

  it('keeps custom unkeyed seeds uncacheable', async () => {
    const seed = vi.fn(seedAiAccountsWorkspace)
    const first = await boot({ seedHome: seed })
    prewarmSibling(first)
    expect(preparation.prepareComposedBootProfile).toHaveBeenCalledTimes(1)
    const second = await boot({ seedHome: seed })
    expect(seed.mock.calls.map(([home]) => home)).toEqual([first.homeRoot, second.homeRoot])
  })

  it('seeds the standalone AI Accounts fixture but leaves unrelated profiles alone', async () => {
    const accounts = await bootPluginProfile('@dshfiles/ai-accounts')
    profiles.push(accounts)
    expect(await readFile(join(accounts.homeRoot, 'storages/workspace.json'), 'utf8')).toContain('ai-accounts-project')
    const unrelated = await boot()
    await expect(readFile(join(unrelated.homeRoot, 'storages/workspace.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('disposes a prepared home when its seed fails, without launching a Host', async () => {
    await expect(
      boot({
        seedHome: async () => {
          throw new Error('seed failed')
        },
      }),
    ).rejects.toThrow('seed failed')
    const [home] = roots
    expect(home).toBeDefined()
    await expect(readFile(join(home ?? '', 'profile/package.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(processes.spawnOwnedProcess).not.toHaveBeenCalled()
  })
})
