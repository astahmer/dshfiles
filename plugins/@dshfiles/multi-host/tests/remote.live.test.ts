import { describe, expect, test } from 'vitest'
import { RemoteDoctor } from '../src/remote-doctor.js'
import { RemoteExec } from '../src/remote-exec.js'
import { RemoteProvision } from '../src/remote-provision.js'
import { RemoteRuntime } from '../src/remote-runtime.js'
import { RemoteCheckout } from '../src/remote-checkout.js'

// Read-only checks against a real machine: MULTI_HOST_SSH_TARGET=m1-perso pnpm test
const sshTarget = process.env.MULTI_HOST_SSH_TARGET
const checkoutPath = process.env.MULTI_HOST_SSH_CHECKOUT

describe.skipIf(sshTarget === undefined)('remote primitives against a live host', () => {
  const target = sshTarget ?? ''

  test('the doctor reads facts and names the diagnostics', async () => {
    const facts = await RemoteDoctor.readFacts({ sshTarget: target, profile: 'web', checkoutPath })
    expect(facts.uname.length).toBeGreaterThan(0)
    expect(facts.home).toBeDefined()
    expect(Array.isArray(RemoteDoctor.diagnose({ facts, expected: { profile: 'web' } }))).toBe(true)
    expect(facts.checkout.path.length).toBeGreaterThan(0)
  }, 60_000)

  test('exec returns the remote exit code and streams', async () => {
    const ok = await RemoteExec.run({ sshTarget: target, command: 'printf hello' })
    expect(ok).toMatchObject({ ok: true, code: 0, stdout: 'hello' })
    const failed = await RemoteExec.run({ sshTarget: target, command: 'exit 3' })
    expect(failed).toMatchObject({ ok: false, code: 3 })
  }, 60_000)

  test('runtime status and logs are readable without mutating anything', async () => {
    const status = await RemoteRuntime.readStatus({
      sshTarget: target,
      remoteHome: `${(await RemoteDoctor.readFacts({ sshTarget: target, profile: 'web' })).home ?? ''}/.dsh`,
    })
    expect(status.launchFiles.length).toBeGreaterThan(0)
    const logs = await RemoteExec.run({ sshTarget: target, command: RemoteRuntime.logsCommand({ logFile: status.logFile, lines: 5 }) })
    expect(logs.ok).toBe(true)
  }, 60_000)

  test('provisioning dry-runs plan without touching the machine', async () => {
    const facts = await RemoteDoctor.readFacts({ sshTarget: target, profile: 'web', checkoutPath })
    const options = {
      remoteHome: `${facts.home ?? ''}/.dsh`,
      checkoutPath: facts.checkout.path,
      profile: 'web',
      dshVersion: '0.2.1-rc.2',
      nodeVersion: '22.23.3',
      repository: 'git@github.com:astahmer/dshfiles.git',
    }
    const plan = RemoteProvision.plan({ facts, options })
    expect(plan.length).toBe(7)
    const dryRun = await RemoteProvision.run({ sshTarget: target, facts, options, steps: ['node', 'checkout'], confirm: 'all', dryRun: true })
    expect(dryRun.executed).toEqual([])
  }, 60_000)

  test('checkout sync dry-run reports without fetching', async () => {
    const facts = await RemoteDoctor.readFacts({ sshTarget: target, profile: 'web', checkoutPath })
    const run = await RemoteCheckout.run({ sshTarget: target, facts, bookmark: 'main', apply: false })
    expect(run.applied).toBe(false)
  }, 60_000)
})
