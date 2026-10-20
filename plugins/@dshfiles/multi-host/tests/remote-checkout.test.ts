import { describe, expect, test } from 'vitest'
import type { RemoteFacts } from '../src/remote-doctor.js'
import { RemoteCheckout } from '../src/remote-checkout.js'

const factsOf = ({
  commitId,
  mainOrigin,
  exists = true,
}: {
  readonly commitId?: string
  readonly mainOrigin?: string
  readonly exists?: boolean
}): RemoteFacts => ({
  uname: 'Darwin arm64',
  osVersion: '26.5.1',
  user: 'me',
  home: '/Users/me',
  node: { path: '/opt/homebrew/bin/node', version: 'v22.23.3', resolved: '/opt/homebrew/.../node', nix: false },
  fnm: { path: '/opt/homebrew/bin/fnm', nodes: [] },
  dsh: { path: undefined, version: undefined },
  jj: { path: '/Users/me/.nix-profile/bin/jj', version: 'jj 0.45.1' },
  pnpm: { path: '/Users/me/.nix-profile/bin/pnpm', version: '12.3.4' },
  launch: { files: [], port: undefined, pid: undefined },
  profile: { path: '~/.dsh/profiles/web', exists: false, pluginLinks: 0, coreVersion: undefined },
  checkout: {
    path: '/Users/me/dev/dshfiles',
    exists,
    installed: true,
    built: true,
    changeId: 'abc',
    commitId,
    description: 'feat: x',
    conflicts: 0,
    mainOrigin,
  },
})

describe('remote checkout sync', () => {
  test('an up-to-date checkout plans nothing', () => {
    const plan = RemoteCheckout.plan({ facts: factsOf({ commitId: 'def456', mainOrigin: 'def456' }), bookmark: 'main', apply: true })
    expect(plan.upToDate).toBe(true)
    expect(plan.commands).toEqual([])
  })

  test('a behind checkout plans a fetch then a rebase onto the bookmark origin', () => {
    const plan = RemoteCheckout.plan({ facts: factsOf({ commitId: 'def400', mainOrigin: 'def456' }), bookmark: 'main', apply: false })
    expect(plan.upToDate).toBe(false)
    expect(plan.commands).toEqual([
      "'/Users/me/.nix-profile/bin/jj' -R '/Users/me/dev/dshfiles' git fetch",
      "'/Users/me/.nix-profile/bin/jj' -R '/Users/me/dev/dshfiles' rebase -r @ -d 'main@origin'",
    ])
    expect(plan.reason).toContain('would fetch')
  })

  test('a missing checkout never pretends to sync', () => {
    const plan = RemoteCheckout.plan({ facts: factsOf({ exists: false }), bookmark: 'main', apply: true })
    expect(plan.commands).toEqual([])
    expect(plan.reason).toBe('no checkout at that path')
  })

  test('a dry run reports without applying', async () => {
    const run = await RemoteCheckout.run({ sshTarget: 'example', facts: factsOf({ commitId: 'def400', mainOrigin: 'def456' }), bookmark: 'main', apply: false })
    expect(run).toMatchObject({ ok: true, applied: false })
    expect(run.detail).toContain('would fetch')
  })
})
