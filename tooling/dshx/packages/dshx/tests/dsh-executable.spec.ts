import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDshExecutable } from '../src/project/dsh-executable.js'
import { readProfileComposition } from '../src/project/profile-composition.js'

const roots: string[] = []
const root = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'dshx-executable-'))
  roots.push(path)
  return path
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('verification DSH executable selection', () => {
  it('preserves PATH defaults and explicit API command options', async () => {
    expect(await resolveDshExecutable(undefined, {})).toBe('dsh')
    expect(await resolveDshExecutable('custom-dsh', { DSHX_DSH_EXECUTABLE: 'invalid-relative-override' })).toBe('custom-dsh')
  })

  it.each(['', 'dsh', './bin/dsh', '~/bin/dsh', '/tmp/invalid\0dsh'])(
    'rejects invalid overrides without falling back to a personal launcher: %j',
    async value => {
      await expect(resolveDshExecutable(undefined, { DSHX_DSH_EXECUTABLE: value })).rejects.toThrow('absolute executable file')
    },
  )

  it('requires an existing executable file rather than a missing file, directory or non-executable script', async () => {
    const directory = await root()
    const file = join(directory, 'core')
    await writeFile(file, `#!${process.execPath}\n`)
    await chmod(file, 0o600)
    await expect(resolveDshExecutable(undefined, { DSHX_DSH_EXECUTABLE: join(directory, 'missing') })).rejects.toThrow('existing executable file')
    await expect(resolveDshExecutable(undefined, { DSHX_DSH_EXECUTABLE: directory })).rejects.toThrow('existing executable file')
    await expect(resolveDshExecutable(undefined, { DSHX_DSH_EXECUTABLE: file })).rejects.toThrow('execute permission')
    await chmod(file, 0o700)
    expect(await resolveDshExecutable(undefined, { DSHX_DSH_EXECUTABLE: file })).toBe(file)
  })

  it('uses the installed executable override for a direct composition read with only the isolated environment', async () => {
    const directory = await root()
    const dshHome = join(directory, 'scratch-home')
    const profileRoot = join(dshHome, 'profiles', 'fixture')
    await mkdir(profileRoot, { recursive: true })
    const executable = join(directory, 'installed-core')
    await writeFile(
      executable,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({ home: process.env.HOME, dshHome: process.env.DSH_HOME, profileRoot: process.env.DSHX_BOOT_PROFILE_ROOT, inheritedToken: process.env.GH_TOKEN !== undefined }))\n`,
    )
    await chmod(executable, 0o700)
    vi.stubEnv('DSHX_DSH_EXECUTABLE', executable)
    vi.stubEnv('HOME', '/real-home-not-used')
    vi.stubEnv('GH_TOKEN', 'synthetic-not-forwarded')
    const dump = await readProfileComposition({ projectRoot: directory, profile: 'fixture', profileRoot, dshHome, timeoutMs: 2_000 })
    expect(JSON.parse(dump)).toEqual({ home: dshHome, dshHome, profileRoot, inheritedToken: false })
  })
})
