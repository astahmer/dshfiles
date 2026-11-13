import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const runProbe = ({ checkoutPath, extraPath = [] }: { readonly checkoutPath: string | undefined; readonly extraPath?: readonly string[] }) =>
  RemoteDoctor.parseFacts({
    output: execFileSync('sh', ['-c', RemoteDoctor.probeScript({ profile: 'web', checkoutPath })], {
      env: { HOME: home, PATH: [...extraPath, '/usr/bin', '/bin'].join(':') },
      encoding: 'utf8',
    }),
    profile: 'web',
    checkoutPath,
  })

describe('remote probe', () => {
  test('reports the default checkout under the remote home when no checkoutPath is given', () => {
    const facts = runProbe({ checkoutPath: undefined })
    expect(facts.checkout.path).toBe(`${home}/dev/dshfiles`)
  })
})
