import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startScratchProfile, type BootedProfile } from './boot.js'
import type { PreparedBootProfile } from '../../packages/dshx/src/project/boot-profile.js'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('E2E installed core selection', () => {
  it('pins the selected executable across fixture restart and revalidates composition when the executable changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-e2e-executable-'))
    roots.push(root)
    const homeRoot = join(root, 'home')
    const profileRoot = join(homeRoot, 'profiles', 'fixture')
    await mkdir(profileRoot, { recursive: true })
    await writeFile(join(profileRoot, 'package.json'), '{}')
    const makeCore = async (name: string): Promise<string> => {
      const file = join(root, name)
      await writeFile(
        file,
        `#!${process.execPath}\n
        const dump = process.argv.includes('--dump-config')
        require('node:fs').appendFileSync(${JSON.stringify(join(root, `${name}.jsonl`))}, JSON.stringify({ dump, home: process.env.HOME, dshHome: process.env.DSH_HOME, profileRoot: process.env.DSHX_BOOT_PROFILE_ROOT, inheritedToken: process.env.GH_TOKEN !== undefined }) + '\\n')
        if (dump) process.stdout.write('@test/plugin\\n')
        else { const port = process.argv[process.argv.indexOf('--port') + 1]; process.stdout.write('http://127.0.0.1:' + port + '/fake?token=synthetic\\n'); setInterval(() => {}, 1000) }
      `,
      )
      await chmod(file, 0o700)
      return file
    }
    const firstCore = await makeCore('first-core')
    const secondCore = await makeCore('second-core')
    const prepared: PreparedBootProfile = { homeRoot, profileRoot, profile: 'fixture', expectedBundles: ['@test/plugin'], dispose: async () => undefined }
    const captures = async (name: string): Promise<unknown[]> =>
      (await readFile(join(root, `${name}.jsonl`), 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    const expectedCapture = (dump: boolean) => ({ dump, home: homeRoot, dshHome: homeRoot, profileRoot, inheritedToken: false })
    let first: BootedProfile | undefined
    let second: BootedProfile | undefined
    vi.stubEnv('GH_TOKEN', 'synthetic-not-forwarded')
    try {
      vi.stubEnv('DSHX_DSH_EXECUTABLE', firstCore)
      first = await startScratchProfile(prepared, 'fixture', [], 3_000)
      // Even if the caller changes its environment, a fixture-owned restart stays on the validated core.
      vi.stubEnv('DSHX_DSH_EXECUTABLE', secondCore)
      await first.restart()
      await first.close()
      first = undefined
      second = await startScratchProfile(prepared, 'fixture', [], 3_000)
      expect(await captures('first-core')).toEqual([true, false, false].map(expectedCapture))
      expect(await captures('second-core')).toEqual([true, false].map(expectedCapture))
    } finally {
      await first?.close()
      await second?.close()
    }
  })
})
