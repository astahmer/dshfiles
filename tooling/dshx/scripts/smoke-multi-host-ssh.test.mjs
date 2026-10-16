import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSshOptions, quoteRemoteArgument, redactLaunchSecrets } from './smoke-multi-host-ssh-utils.mjs'

const smokeScriptPath = fileURLToPath(new URL('./smoke-multi-host-ssh.mjs', import.meta.url))
const environmentWithoutSmokeConfig = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('MH_')))
const smokeBaseConfig = {
  MH_SSH_TARGET: 'user@dsh-test.invalid',
  MH_SSH_KEY: '/tmp/disposable-key',
  MH_KNOWN_HOSTS: '/tmp/disposable-known-hosts',
  MH_UNIT: 'dsh-web-smoke.service',
  MH_WS: '/tmp/dsh-workspace',
  MH_REMOTE_HOME: '/tmp/dsh-home',
}
const scratchDirectories = []
after(async () => {
  for (const directory of scratchDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})
const runSmoke = smokeConfig =>
  spawnSync(process.execPath, ['--experimental-strip-types', smokeScriptPath], {
    encoding: 'utf8',
    env: { ...environmentWithoutSmokeConfig, ...smokeConfig },
    timeout: 15_000,
  })
const expectConfigurationFailure = result => {
  const output = `${result.stdout}\n${result.stderr}`

  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, output)
  assert.match(output, /requires explicit MH_SSH_TARGET/)
  assert.doesNotMatch(output, /existing private-key file|systemctl --user|ssh remote command|dsh web --port/)
  assert.doesNotMatch(output, /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~-]+/)
}

test('SSH smoke rejects missing configuration before DSH startup or network use', () => {
  expectConfigurationFailure(runSmoke({}))
})

test('SSH smoke requires an explicit disposable-target opt-in', () => {
  expectConfigurationFailure(runSmoke({ ...smokeBaseConfig, MH_ALLOW_REMOTE_MUTATIONS: '1' }))
})

test('SSH smoke requires an explicit remote-mutation opt-in', () => {
  expectConfigurationFailure(runSmoke({ ...smokeBaseConfig, MH_DISPOSABLE_TARGET: '1' }))
})

test('SSH smoke rejects ports outside the TCP range before file or network access', () => {
  expectConfigurationFailure(
    runSmoke({
      ...smokeBaseConfig,
      MH_DISPOSABLE_TARGET: '1',
      MH_ALLOW_REMOTE_MUTATIONS: '1',
      MH_SSH_PORT: '65536',
    }),
  )
})

test('SSH smoke rejects group/other-writable known_hosts before invoking SSH', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ssh-smoke-known-hosts-'))
  scratchDirectories.push(directory)
  const sshKey = join(directory, 'id_ed25519')
  const knownHosts = join(directory, 'known_hosts')
  await writeFile(sshKey, 'disposable test key', { mode: 0o600 })
  await writeFile(knownHosts, 'disposable test host key', { mode: 0o600 })
  await chmod(knownHosts, 0o666)

  const result = runSmoke({
    ...smokeBaseConfig,
    MH_SSH_KEY: sshKey,
    MH_KNOWN_HOSTS: knownHosts,
    MH_DISPOSABLE_TARGET: '1',
    MH_ALLOW_REMOTE_MUTATIONS: '1',
  })
  const output = `${result.stdout}\n${result.stderr}`

  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, output)
  assert.match(output, /not group\/other-writable/)
  assert.doesNotMatch(output, /SSH remote command|systemctl --user|http:\/\/127\.0\.0\.1:\d+\/\?token=/)
})

test('SSH transport ignores user config and uses only explicit strict identity files', () => {
  assert.deepEqual(buildSshOptions({ sshKey: '/tmp/disposable-key', knownHosts: '/tmp/disposable-known-hosts', sshPort: 2222 }), [
    '-p',
    '2222',
    '-F',
    '/dev/null',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UserKnownHostsFile=/tmp/disposable-known-hosts',
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    'IdentitiesOnly=yes',
    '-i',
    '/tmp/disposable-key',
    '-o',
    'ForwardAgent=no',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ConnectTimeout=15',
  ])
})

test('SSH transport preserves the default port 22', () => {
  assert.deepEqual(buildSshOptions({ sshKey: '/tmp/disposable-key', knownHosts: '/tmp/disposable-known-hosts' }).slice(0, 2), ['-p', '22'])
})

test('remote path quoting preserves shell metacharacters as data', () => {
  const remotePath = `workspace with spaces/$(printf injected);'quoted'`
  const result = spawnSync('/bin/sh', ['-c', `printf %s ${quoteRemoteArgument(remotePath)}`], { encoding: 'utf8' })

  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, remotePath)
})

test('log redaction removes complete launch URLs and supported token characters', () => {
  const launchUrl = 'http://127.0.0.1:39412/?token=token.With~mixed_Chars-123'
  const output = redactLaunchSecrets(`launch=${launchUrl} token=another_secret`)

  assert.equal(output, 'launch=<launch-url-redacted> token=<redacted>')
  assert.doesNotMatch(output, /token\.With~mixed_Chars-123|another_secret/)
})
