import { describe, expect, test } from 'vitest'
import { RemoteDoctor } from '../src/remote-doctor.js'

const probeOutput = [
  'checkout_path=/Users/me/dev/dshfiles',
  'uname=Darwin arm64',
  'os=26.5.1',
  'user=me',
  'home=/Users/me',
  'node_path=/Users/me/.nix-profile/bin/node',
  'fnm_path=',
  'fnm_brew=/opt/homebrew/bin/fnm',
  'dsh_path=/Users/me/.local/share/pnpm/bin/dsh',
  'jj_path=/Users/me/.nix-profile/bin/jj',
  'pnpm_path=/Users/me/.nix-profile/bin/pnpm',
  'node_real=/nix/store/abcdef-nodejs-22.23.3/bin/node',
  'node_version=v22.23.3',
  'dsh_version=0.2.1-rc.2',
  'jj_version=jj 0.45.1',
  'pnpm_version=12.3.4',
  'fnm_node=v22.11.0|/Users/me/Library/Application Support/fnm/node-versions/v22.11.0/installation/bin/node',
  'fnm_node=v22.23.3|/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin/node',
  'launch_file=/Users/me/.dsh/plugins/multi-host/launch.json',
  'launch_port=64684',
  'launch_pid=31838',
  'profile_exists=1',
  'profile_plugin_links=52',
  'profile_core_version=0.2.0-rc.2',
  'checkout_exists=1',
  'checkout_installed=1',
  'checkout_built=1',
  'checkout_head=abc123|def456|feat(multi-host): x',
  'checkout_conflicts=0',
  'checkout_main_origin=def400',
].join('\n')

describe('remote doctor', () => {
  test('decodes facts from the probe output and reads a Nix node as unusable', () => {
    const facts = RemoteDoctor.parseFacts({ output: probeOutput, profile: 'web', checkoutPath: undefined })
    expect(facts.node.nix).toBe(true)
    expect(facts.node.resolved).toBe('/nix/store/abcdef-nodejs-22.23.3/bin/node')
    expect(facts.fnm.path).toBe('/opt/homebrew/bin/fnm')
    expect(facts.fnm.nodes.map(node => node.version)).toEqual(['v22.11.0', 'v22.23.3'])
    expect(facts.launch).toEqual({ files: ['/Users/me/.dsh/plugins/multi-host/launch.json'], port: 64684, pid: 31838 })
    expect(facts.profile).toEqual({ path: '~/.dsh/profiles/web', exists: true, pluginLinks: 52, coreVersion: '0.2.0-rc.2' })
    expect(facts.checkout).toMatchObject({ path: '/Users/me/dev/dshfiles', installed: true, built: true, changeId: 'abc123', commitId: 'def456', conflicts: 0 })
  })

  test('picks the highest fnm node at or above the minimum', () => {
    const facts = RemoteDoctor.parseFacts({ output: probeOutput, profile: 'web', checkoutPath: undefined })
    expect(RemoteDoctor.officialNodePath({ nodes: facts.fnm.nodes, minimum: '22.19.0' })).toBe(
      '/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin/node',
    )
    expect(RemoteDoctor.officialNodePath({ nodes: facts.fnm.nodes, minimum: '22.24.0' })).toBeUndefined()
  })

  test('reports the Nix node, the stale profile core and the moving checkout as actionable diagnostics', () => {
    const facts = RemoteDoctor.parseFacts({ output: probeOutput, profile: 'web', checkoutPath: undefined })
    const diagnostics = RemoteDoctor.diagnose({ facts, expected: { profile: 'web', dshVersion: '0.2.1-rc.2' } })
    expect(diagnostics.map(diagnostic => [diagnostic.code, diagnostic.severity])).toEqual([
      ['node-is-nix', 'error'],
      ['official-node-available', 'info'],
      ['profile-core-stale', 'error'],
      ['checkout-behind', 'info'],
    ])
  })

  test('a machine with no runtime, no checkout and no official node names what is missing', () => {
    const facts = RemoteDoctor.parseFacts({
      output: 'home=/home/me\nnode_path=/nix/store/x/bin/node\nnode_real=/nix/store/x/bin/node',
      profile: 'web',
      checkoutPath: '/home/me/dev/dshfiles',
    })
    const codes = RemoteDoctor.diagnose({ facts, expected: { profile: 'web' } }).map(diagnostic => diagnostic.code)
    expect(codes).toEqual(['node-is-nix', 'fnm-missing', 'dsh-missing', 'runtime-not-running', 'profile-missing', 'checkout-missing'])
  })
})
