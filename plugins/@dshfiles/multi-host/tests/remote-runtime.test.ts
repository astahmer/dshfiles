import { describe, expect, test } from 'vitest'
import { RemoteExec } from '../src/remote-exec.js'
import { RemoteRuntime } from '../src/remote-runtime.js'

describe('remote exec', () => {
  test('quotes the working directory and leaves the command itself alone', () => {
    expect(RemoteExec.buildCommand({ command: 'pwd && ls', cwd: '/Users/me/my folder' })).toBe("cd '/Users/me/my folder' && pwd && ls")
    expect(RemoteExec.buildCommand({ command: 'uname -s', cwd: undefined })).toBe('uname -s')
  })
})

describe('remote runtime', () => {
  test('starts a headless runtime with the official node first and a free port', () => {
    const command = RemoteRuntime.startCommand({
      remoteHome: '/Users/me/.dsh',
      checkoutPath: '/Users/me/dev/dshfiles',
      profile: 'web',
      dshPath: '/Users/me/.local/share/pnpm/bin/dsh',
      platform: 'Darwin',
      pathDirectories: ['/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin', '/Users/me/.local/share/pnpm/bin'],
    })
    expect(command).toContain('caffeinate -i ')
    expect(command).toContain(
      "PATH='/Users/me/Library/Application Support/fnm/node-versions/v22.23.3/installation/bin':'/Users/me/.local/share/pnpm/bin':\"$PATH\"",
    )
    expect(command).toContain('--no-open --host 127.0.0.1 --port 0')
    expect(command).toContain('/Users/me/.dsh/logs/multi-host-web.log')
    expect(command).toContain("DSHFILES_DIR='/Users/me/dev/dshfiles'")
  })

  test('keeps the log tail bounded and reads the launched pid and port', () => {
    expect(RemoteRuntime.logsCommand({ logFile: '/tmp/a b.log', lines: 10_000 })).toBe("tail -n 400 -- '/tmp/a b.log' 2>/dev/null || true")
    const status = RemoteRuntime.parseStatus({
      remoteHome: '/Users/me/.dsh',
      output: [
        'launch_file=/Users/me/.dsh/plugins/multi-host/launch.json',
        'launch_port=64684',
        'launch_pid=31838',
        'launch_command=node .../dsh/lib/bin.js web --no-open',
        'port_listening=1',
        'log_bytes=2048',
      ].join('\n'),
    })
    expect(status).toMatchObject({ running: true, port: 64684, pid: 31838, listening: true, logBytes: 2048 })
  })

  test('refuses a pid that is not a DSH web before signalling it', () => {
    const command = RemoteRuntime.stopCommand({ pid: 42 })
    expect(command).toContain('ps -o command= -p "$pid"')
    expect(command).toContain('*dsh*web*|*bin.js*web*')
    expect(command).toContain('echo "stop=refused"')
    expect(command).toContain('kill -TERM "$pid"')
  })

  test('waits for the launch file with a bounded fallback', () => {
    const command = RemoteRuntime.waitForLaunchCommand({ remoteHome: '/Users/me/.dsh' })
    expect(command).toContain('/Users/me/.dsh/plugins/multi-host/launch.json')
    expect(command).toContain('echo "launch=timeout"')
    expect(command).toContain('hops" -lt 30')
  })
})
