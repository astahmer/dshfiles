import { describe, expect, test } from 'vitest'
import type { RemoteFacts } from '../src/remote-doctor.js'
import { RemoteProvision, type ProvisionOptions } from '../src/remote-provision.js'

const options: ProvisionOptions = {
  remoteHome: '/Users/me/.dsh',
  checkoutPath: '/Users/me/dev/dshfiles',
  profile: 'web',
  dshVersion: '0.2.1-rc.2',
  nodeVersion: '22.23.3',
  repository: 'git@github.com:me/dshfiles.git',
}

const factsOf = ({ overrides = {} }: { readonly overrides?: Partial<RemoteFacts> } = {}): RemoteFacts => ({
  uname: 'Darwin arm64',
  osVersion: '26.5.1',
  user: 'me',
  home: '/Users/me',
  node: { path: '/Users/me/.nix-profile/bin/node', version: 'v22.23.3', resolved: '/nix/store/abc-nodejs-22.23.3/bin/node', nix: true },
  fnm: { path: '/opt/homebrew/bin/fnm', nodes: [] },
  dsh: { path: undefined, version: undefined },
  jj: { path: '/nix/store/jj/bin/jj', version: 'jj 0.45.1' },
  pnpm: { path: '/nix/store/pnpm/bin/pnpm', version: '12.3.4' },
  launch: { files: [], port: undefined, pid: undefined },
  profile: { path: '~/.dsh/profiles/web', exists: false, pluginLinks: 0, coreVersion: undefined },
  checkout: {
    path: '/Users/me/dev/dshfiles',
    exists: false,
    installed: false,
    built: false,
    changeId: undefined,
    commitId: undefined,
    description: undefined,
    conflicts: 0,
    mainOrigin: undefined,
  },
  ...overrides,
})

const readyFacts = (): RemoteFacts => ({
  ...factsOf(),
  node: {
    path: '/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin/node',
    version: 'v22.23.3',
    resolved: '/Users/me/.../node',
    nix: false,
  },
  fnm: {
    path: '/opt/homebrew/bin/fnm',
    nodes: [{ version: 'v22.23.3', path: '/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin/node' }],
  },
  dsh: { path: '/Users/me/.local/share/pnpm/bin/dsh', version: '0.2.1-rc.2' },
  launch: { files: ['/Users/me/.dsh/plugins/multi-host/launch.json'], port: 64684, pid: 31838 },
  profile: { path: '~/.dsh/profiles/web', exists: true, pluginLinks: 52, coreVersion: '0.2.1-rc.2' },
  checkout: {
    ...factsOf().checkout,
    exists: true,
    installed: true,
    built: true,
    changeId: 'abc',
    commitId: 'def456',
    description: 'feat(multi-host): x',
    conflicts: 0,
    mainOrigin: 'def456',
  },
})

describe('provision planning', () => {
  test('a bare machine plans every step and blocks the ones that need an official Node or a checkout', () => {
    const plan = RemoteProvision.plan({ facts: factsOf(), options })
    expect(plan.map(step => [step.id, step.state])).toEqual([
      ['node', 'pending'],
      ['checkout', 'pending'],
      ['install', 'blocked'],
      ['build', 'blocked'],
      ['cli', 'blocked'],
      ['profile', 'blocked'],
      ['runtime', 'blocked'],
    ])
    expect(plan[0]?.commands[0]).toBe("'/opt/homebrew/bin/fnm' install '22.23.3'")
    expect(plan[1]?.commands[0]).toBe("'/nix/store/jj/bin/jj' git clone 'git@github.com:me/dshfiles.git' '/Users/me/dev/dshfiles'")
  })

  test('a ready machine plans nothing to do', () => {
    const plan = RemoteProvision.plan({ facts: readyFacts(), options })
    expect(plan.every(step => step.state === 'done')).toBe(true)
  })

  test('runs commands with the official node first on PATH and the checkout as the directory', () => {
    const facts: RemoteFacts = {
      ...factsOf(),
      fnm: { path: '/opt/homebrew/bin/fnm', nodes: [{ version: 'v22.23.3', path: '/Users/me/fnm/v22.23.3/bin/node' }] },
      checkout: { ...factsOf().checkout, exists: true, installed: false, built: false },
    }
    const plan = RemoteProvision.plan({ facts, options })
    const install = plan.find(step => step.id === 'install')
    expect(install?.state).toBe('pending')
    expect(install?.commands[0]).toContain("cd '/Users/me/dev/dshfiles'")
    expect(install?.commands[0]).toContain('pnpm install --frozen-lockfile')
    expect(install?.commands[0]).toContain("PATH='/Users/me/fnm/v22.23.3/bin'")
  })

  test('a stale profile core plans a resync even when the profile exists', () => {
    const facts: RemoteFacts = { ...readyFacts(), profile: { path: '~/.dsh/profiles/web', exists: true, pluginLinks: 52, coreVersion: '0.2.0-rc.2' } }
    const profile = RemoteProvision.plan({ facts, options }).find(step => step.id === 'profile')
    expect(profile?.state).toBe('pending')
    expect(profile?.commands[0]).toContain('profile-sync.ts --profile')
  })
})

describe('provision runs', () => {
  test('dryRun executes nothing and returns the steps that still need work', async () => {
    const run = await RemoteProvision.run({
      sshTarget: 'example',
      facts: factsOf(),
      options,
      steps: ['node', 'checkout', 'install'],
      confirm: 'all',
      dryRun: true,
    })
    expect(run.executed).toEqual([])
    expect(run.remaining).toEqual(['node', 'checkout', 'install'])
  })

  test('an already-satisfied step is skipped rather than run', async () => {
    const run = await RemoteProvision.run({
      sshTarget: 'example',
      facts: readyFacts(),
      options,
      steps: ['runtime'],
      confirm: 'all',
      dryRun: false,
    })
    expect(run.executed).toEqual([{ id: 'runtime', ok: true, state: 'skipped', detail: expect.any(String), stdout: '', stderr: '' }])
    expect(run.remaining).toEqual([])
  })

  test('a blocked step stops the run before any command is attempted', async () => {
    const run = await RemoteProvision.run({
      sshTarget: 'example',
      facts: factsOf(),
      options,
      steps: ['install'],
      confirm: 'all',
      dryRun: false,
    })
    expect(run.executed.map(result => result.state)).toEqual(['blocked'])
    expect(run.executed[0]?.detail).toBe('the checkout is missing')
  })
})
