import { describe, expect, test } from 'vitest'
import type { RemoteFacts } from '../src/remote-doctor.js'
import { RemoteUpdate } from '../src/remote-update.js'

const nodePath = '/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin/node'

const readyFacts = (checkout: Partial<RemoteFacts['checkout']> = {}): RemoteFacts => ({
  uname: 'Darwin arm64',
  home: '/Users/me',
  node: { path: nodePath, version: 'v22.23.3', resolved: nodePath, nix: false },
  fnm: { path: '/opt/homebrew/bin/fnm', nodes: [{ version: 'v22.23.3', path: nodePath }] },
  dsh: { path: '/Users/me/.local/share/pnpm/bin/dsh', version: '0.2.1-rc.2' },
  jj: { path: '/opt/homebrew/bin/jj', version: 'jj 0.45.1' },
  pnpm: { path: '/Users/me/.local/share/pnpm/pnpm', version: '11.1.0' },
  launch: { files: [], port: undefined, pid: undefined },
  profile: { path: '~/.dsh/profiles/web', exists: true, pluginLinks: 52, coreVersion: '0.2.1-rc.2' },
  checkout: {
    path: '/Users/me/dev/dshfiles',
    exists: true,
    installed: true,
    built: true,
    changeId: 'abc',
    commitId: 'def',
    description: 'x',
    conflicts: 0,
    mainOrigin: 'def',
    ...checkout,
  },
})

const envelope = (data: Record<string, unknown>) =>
  JSON.stringify({
    schemaVersion: 1,
    command: 'checkout sync',
    ok: true,
    data: { to: 'f00d', unlanded: [], conflicts: [], rebuilt: { dshx: false, plugins: [] }, restart: { needed: false, reasons: [] }, ...data },
  })

describe('remote host update', () => {
  test('names what a machine lacks before it can update', () => {
    expect(RemoteUpdate.blockedReason({ facts: readyFacts({ exists: false }), nodePath })).toMatch(/no dshfiles checkout/)
    expect(RemoteUpdate.blockedReason({ facts: readyFacts({ built: false }), nodePath })).toMatch(/provision its build step/)
    expect(RemoteUpdate.blockedReason({ facts: readyFacts(), nodePath: undefined })).toMatch(/official Node/)
    expect(RemoteUpdate.blockedReason({ facts: readyFacts(), nodePath })).toBeUndefined()
  })

  test('fetches, then runs the host checkout sync with its own Node, dry-run unless applied', () => {
    const preview = RemoteUpdate.commands({ facts: readyFacts(), nodePath, bookmark: 'main', apply: false })
    expect(preview.fetch).toBe("'/opt/homebrew/bin/jj' -R '/Users/me/dev/dshfiles' git fetch")
    expect(preview.sync).toContain("cd '/Users/me/dev/dshfiles' && env PATH=")
    expect(preview.sync).toContain(`'${nodePath}' tooling/dshx/packages/dshx/dist/cli/bin.js checkout sync --bookmark 'main' --json --dry-run`)
    expect(RemoteUpdate.commands({ facts: readyFacts(), nodePath, bookmark: 'main', apply: true }).sync).not.toContain('--dry-run')
  })

  test('reports rebuilt plugins and whether the host needs a restart', () => {
    const result = RemoteUpdate.readSyncOutput({
      stdout: envelope({ rebuilt: { dshx: false, plugins: ['@dshfiles/multi-host'] }, restart: { needed: true, reasons: ['host bundle'] } }),
      apply: true,
      checkoutPath: '/Users/me/dev/dshfiles',
    })
    expect(result).toMatchObject({
      ok: true,
      applied: true,
      revision: 'f00d',
      rebuilt: ['@dshfiles/multi-host'],
      restartNeeded: true,
      detail: 'rebuilt 1 plugin',
    })
    expect(RemoteUpdate.readSyncOutput({ stdout: envelope({}), apply: false, checkoutPath: '/x' })).toMatchObject({ ok: true, detail: 'already up to date' })
  })

  test('a refused, conflicted or unreadable sync fails with its recovery', () => {
    const refused = JSON.stringify({ ok: false, error: { code: 'unlanded', message: 'Described work main lacks.', hint: 'Land it first.' } })
    expect(RemoteUpdate.readSyncOutput({ stdout: refused, apply: true, checkoutPath: '/x' })).toMatchObject({
      ok: false,
      detail: 'Described work main lacks. Land it first.',
    })
    expect(RemoteUpdate.readSyncOutput({ stdout: envelope({ conflicts: ['a'] }), apply: true, checkoutPath: '/x' })).toMatchObject({
      ok: false,
      detail: expect.stringContaining('resolve it on the host'),
    })
    expect(RemoteUpdate.readSyncOutput({ stdout: 'command not found', apply: true, checkoutPath: '/x' })).toMatchObject({
      ok: false,
      detail: expect.stringContaining('update dshx on the host'),
    })
  })
})
