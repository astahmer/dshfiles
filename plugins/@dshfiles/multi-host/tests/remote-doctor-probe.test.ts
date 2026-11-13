import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { RemoteDoctor } from '../src/remote-doctor.js'

let home = ''

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'multi-host-probe-')))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

/** The probe as the remote shell runs it, against a scratch home and a minimal PATH. */
const writeExecutable = async ({ path, script }: { readonly path: string; readonly script: string }) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
}

const runProbe = ({
  checkoutPath,
  revision,
  dshHome,
  extraPath = [],
}: {
  readonly checkoutPath: string | undefined
  readonly revision?: string | undefined
  readonly dshHome?: string | undefined
  readonly extraPath?: readonly string[]
}) =>
  RemoteDoctor.parseFacts({
    output: execFileSync('sh', ['-c', RemoteDoctor.probeScript({ profile: 'web', checkoutPath, revision, dshHome })], {
      env: { HOME: home, PATH: [...extraPath, '/usr/bin', '/bin'].join(':'), JJ_CONFIG: join(home, 'jj.toml') },
      encoding: 'utf8',
    }),
    profile: 'web',
    checkoutPath,
    dshHome,
  })

describe('remote probe', () => {
  test('reports the default checkout under the remote home when no checkoutPath is given', () => {
    const facts = runProbe({ checkoutPath: undefined })
    expect(facts.checkout.path).toBe(`${home}/dev/dshfiles`)
  })

  test('finds dsh in the pnpm global bin and reads its version with the official Node first on PATH', async () => {
    await writeExecutable({ path: join(home, '.local/share/fnm/node-versions/v22.23.3/installation/bin/node'), script: 'echo official' })
    await writeExecutable({ path: join(home, '.local/share/pnpm/bin/dsh'), script: '[ "$(node)" = official ] && echo 0.2.2-rc.2' })
    const facts = runProbe({ checkoutPath: undefined })
    expect(facts.dsh.path).toBe(join(home, '.local/share/pnpm/bin/dsh'))
    expect(facts.dsh.version).toBe('0.2.2-rc.2')
  })

  test('reads the profile and launch file from the requested DSH home', async () => {
    const dshHome = join(home, 'dsh-mh')
    await mkdir(join(dshHome, 'profiles', 'web'), { recursive: true })
    await mkdir(join(dshHome, 'plugins', 'multi-host'), { recursive: true })
    await writeFile(join(dshHome, 'plugins', 'multi-host', 'launch.json'), '{"url":"http://127.0.0.1:4100","pid":42}')
    const facts = runProbe({ checkoutPath: undefined, dshHome })
    expect(facts.profile).toMatchObject({ path: join(dshHome, 'profiles', 'web'), exists: true })
    expect(facts.launch).toEqual({ files: [join(dshHome, 'plugins', 'multi-host', 'launch.json')], port: 4100, pid: 42 })
  })

  test('resolves the requested revision to the commit the checkout sits on', async () => {
    const jjDirectory = dirname(execFileSync('sh', ['-c', 'command -v jj'], { encoding: 'utf8' }).trim())
    const checkout = join(home, 'dev', 'dshfiles')
    await mkdir(checkout, { recursive: true })
    await writeFile(join(home, 'jj.toml'), 'user.name = "Tester"\nuser.email = "tester@example.com"\n')
    const jj = (...args: string[]) =>
      execFileSync('jj', ['--color=never', ...args], {
        cwd: checkout,
        env: { HOME: home, PATH: process.env.PATH, JJ_CONFIG: join(home, 'jj.toml') },
        encoding: 'utf8',
      })
    jj('git', 'init')
    await writeFile(join(checkout, 'README.md'), 'x\n')
    jj('commit', '-m', 'first')
    jj('bookmark', 'set', 'main', '-r', '@-')
    const main = jj('log', '--no-graph', '-r', 'main', '-T', 'commit_id.short()').trim()
    const facts = runProbe({ checkoutPath: checkout, revision: 'main', extraPath: [jjDirectory] })
    expect(facts.checkout.revisionCommitId).toBe(main)
    expect(facts.checkout.parentCommitId).toBe(main)
    expect(facts.checkout.commitId).not.toBe(main)
  })
})
