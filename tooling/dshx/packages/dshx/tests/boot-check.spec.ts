import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkPluginBoot } from '../src/project/boot-check.js'

const roots: string[] = []

const executable = async (source: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-boot-fixture-'))
  roots.push(root)
  const file = join(root, 'dsh-fixture')
  await writeFile(file, `#!${process.execPath}\n${source}\n`)
  await chmod(file, 0o755)
  return file
}

const scratchProfile = async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-boot-profile-fixture-'))
  roots.push(root)
  const dshHome = join(root, 'home')
  const profileRoot = join(dshHome, 'profiles', 'fixture')
  await mkdir(profileRoot, { recursive: true })
  return { dshHome, profileRoot }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Host boot check ownership', () => {
  it('honors an explicit installed executable override for composition and Host without invoking a personal launcher', async () => {
    const profile = await scratchProfile()
    const capture = join(profile.dshHome, 'environment.jsonl')
    const wrapperMarker = join(profile.dshHome, 'personal-launcher-ran')
    const core = await executable(`
      const fs = require('node:fs')
      fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({
        dump: process.argv.includes('--dump-config'), home: process.env.HOME, dshHome: process.env.DSH_HOME,
        profileRoot: process.env.DSHX_BOOT_PROFILE_ROOT, configHome: process.env.XDG_CONFIG_HOME,
        inheritedKey: process.env.OPENAI_API_KEY !== undefined
      }) + '\\n')
      if (process.argv.includes('--dump-config')) process.stdout.write('@test/plugin\\n')
      else { process.stdout.write('http://127.0.0.1:3199/test?token=synthetic\\n'); setInterval(() => {}, 1000) }
    `)
    const wrapper = join(dirname(core), 'dsh')
    await writeFile(wrapper, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(wrapperMarker)}, 'unsafe wrapper'); process.exit(1)\n`)
    await chmod(wrapper, 0o755)
    vi.stubEnv('PATH', `${dirname(core)}${delimiter}${process.env.PATH ?? ''}`)
    vi.stubEnv('HOME', '/not-the-scratch-home')
    vi.stubEnv('DSH_HOME', '/not-the-scratch-dsh-home')
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-must-not-cross')
    vi.stubEnv('DSHX_DSH_EXECUTABLE', core)

    const result = await checkPluginBoot({ projectRoot: process.cwd(), profile: 'fixture', port: 3199, ...profile, expectedBundles: ['@test/plugin'] })

    expect(result.ok).toBe(true)
    const captures: unknown[] = (await readFile(capture, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    expect(captures).toEqual(
      [true, false].map(dump => ({
        dump,
        home: profile.dshHome,
        dshHome: profile.dshHome,
        profileRoot: profile.profileRoot,
        configHome: join(profile.dshHome, 'config'),
        inheritedKey: false,
      })),
    )
    await expect(access(wrapperMarker)).rejects.toThrow()
  })

  it('captures a started Host and cleans its owned process group', async () => {
    const file = await executable(
      "if (process.argv.includes('--dump-config')) process.stdout.write('@test/plugin\\n'); else { process.stdout.write('http://127.0.0.1:3199/test?token=secret\\n'); setInterval(() => {}, 1000) }",
    )
    const profile = await scratchProfile()
    const result = await checkPluginBoot({
      projectRoot: process.cwd(),
      profile: 'fixture',
      port: 3199,
      executable: file,
      ...profile,
      expectedBundles: ['@test/plugin'],
    })
    expect(result.ok).toBe(true)
    expect(result.url).toBe('http://127.0.0.1:3199')
    expect(JSON.stringify(result)).not.toContain('token=secret')
  })

  it('reports a missing executable as a spawn failure instead of a timeout', async () => {
    const profile = await scratchProfile()
    const result = await checkPluginBoot({
      projectRoot: process.cwd(),
      profile: 'fixture',
      port: 3199,
      executable: join(tmpdir(), 'missing-dshx-executable'),
      ...profile,
      expectedBundles: ['@test/plugin'],
    })
    expect(result.timedOut).toBe(false)
    expect(result.processError).toContain('dsh --dump-config could not start')
  })

  it('identifies an unsupported Node build from composition stderr without echoing it', async () => {
    const file = await executable("process.stderr.write('Error: node-addon-require-builtin unsupported: Unsupported/no-getter'); process.exit(1)")
    const profile = await scratchProfile()
    const result = await checkPluginBoot({
      projectRoot: process.cwd(),
      profile: 'fixture',
      port: 3199,
      executable: file,
      ...profile,
      expectedBundles: ['@test/plugin'],
    })

    expect(result).toMatchObject({ ok: false, timedOut: false, unsupportedNode: true })
    expect(result.processError).toContain('node-addon-require-builtin unsupported')
    expect(result.processError).not.toContain('Unsupported/no-getter')
  })

  it('stops a Host that never announces readiness', async () => {
    const file = await executable("if (process.argv.includes('--dump-config')) process.stdout.write('@test/plugin\\n'); else setInterval(() => {}, 1000)")
    const profile = await scratchProfile()
    const result = await checkPluginBoot({
      projectRoot: process.cwd(),
      profile: 'fixture',
      port: 3199,
      executable: file,
      // The same budget first covers the --dump-config launch, which a loaded machine can take well over 500 ms to answer.
      timeoutMs: 3_000,
      ...profile,
      expectedBundles: ['@test/plugin'],
    })
    expect(result.ok).toBe(false)
    expect(result.timedOut).toBe(true)
  })

  it('refuses to start when the offline composition omits the requested bundle', async () => {
    const profile = await scratchProfile()
    const marker = join(profile.profileRoot, 'host-started')
    const file = await executable(
      `if (process.argv.includes('--dump-config')) process.stdout.write('@deepseek-ai/dsh-base\\n'); else { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); process.stdout.write('http://127.0.0.1:3199/test\\n') }`,
    )
    const result = await checkPluginBoot({
      projectRoot: process.cwd(),
      profile: 'fixture',
      port: 3199,
      executable: file,
      ...profile,
      expectedBundles: ['@test/plugin'],
    })
    const hostStarted = await access(marker).then(
      () => true,
      () => false,
    )
    expect(result.ok).toBe(false)
    expect(result.compositionFailures).toEqual(['@test/plugin'])
    expect(hostStarted).toBe(false)
    await rm(marker, { force: true })
  })
})
