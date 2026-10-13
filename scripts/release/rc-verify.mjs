import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const repoRoot = '/Users/astahmer/dev/dshfiles-release-candidate'
const RUNTIME = '/private/tmp/dsh-rc-runtime'
const DSH_BIN = `${RUNTIME}/node_modules/@deepseek-ai/dsh/lib/bin.js`
// dshx is a build tool; use the fully installed copy from the working checkout
// while the Host under test is the isolated RC runtime.
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(
  new URL('file:///Users/astahmer/dev/dshfiles-core-narrow/tooling/dshx/packages/dshx/dist/project/scratch-profile.js').href
)
const scratch = await createScratchProfile({
  profileName: 'rc-verify',
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/jj-integration'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies: { '@dshfiles/jj-integration': `link:${repoRoot}/plugins/@dshfiles/jj-integration` },
})
await scratch.install()

const project = resolve(scratch.home, 'project')
await mkdir(project, { recursive: true })
const jjConfig = resolve(scratch.home, 'jj-config.toml')
await writeFile(jjConfig, '[user]\nname = "RC Verify"\nemail = "rc@example.com"\n', { mode: 0o600 })
const jjEnv = { ...process.env, JJ_CONFIG: jjConfig }
const jj = (...args) => execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd: project, env: jjEnv, encoding: 'utf8' })
jj('git', 'init', '.')
await writeFile(resolve(project, 'base.txt'), 'base\n')
jj('describe', '-m', 'base')
jj('bookmark', 'create', 'integration-spine', '-r', jj('log', '-r', '@', '--no-graph', '-T', 'commit_id').trim())
jj('new')

let output = ''
const child = spawn(process.execPath, [DSH_BIN, 'rc-verify', '--port', '0', '--no-open'], {
  cwd: project,
  env: isolatedHostEnvironment(scratch.home, scratch.profileRoot),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
child.stdout.on('data', c => (output += c.toString()))
child.stderr.on('data', c => (output += c.toString()))
const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/
const started = Date.now()
while (!urlPattern.test(output)) {
  if (Date.now() - started > 90_000) throw new Error('host not ready\n' + redactHostOutput(output.slice(-2000)))
  await new Promise(d => setTimeout(d, 200))
}
const launchUrl = output.match(urlPattern)[0]
const parsedUrl = new URL(launchUrl)
const index = await fetch(launchUrl, { redirect: 'manual' })
const cookie = index.headers.getSetCookie?.()[0] ?? index.headers.get('set-cookie')
const rpc = async (ns, method, args) => {
  const response = await fetch(`${parsedUrl.origin}/api/${ns}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${ns}/${method}`, payload: { args } }),
  })
  const body = await response.text()
  const envelope = response.status === 200 ? JSON.parse(body) : undefined
  return { status: response.status, ok: envelope?.result?.ok, value: envelope?.result?.value, error: envelope?.result?.error, raw: body }
}
const made = await rpc('workspace', 'create', { request: { path: project, title: 'dshfiles' } })
const workspaceId = made.value?.workspace?.workspaceId
console.log('workspace/create:', made.status, '| workspaceId:', workspaceId ?? '(none)')

for (const sessionId of ['session-rc-alpha', 'session-rc-beta']) {
  const created = await rpc('session', 'create', { request: { sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) } })
  console.log(`session/create ${sessionId}:`, created.status, '| ok:', created.ok, created.ok ? '' : JSON.stringify(created.error).slice(0, 200))
}
await new Promise(d => setTimeout(d, 4000))
const provisioned = jj('workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\\n"')
  .split('\n')
  .filter(n => n && n !== 'default')
console.log('provisioned jj workspaces:', JSON.stringify(provisioned), '| distinct:', new Set(provisioned).size)

// Resume: the same thread must keep its workspace.
const before = provisioned.length
const resumed = await rpc('session', 'create', { request: { sessionId: 'session-rc-alpha', ...(workspaceId === undefined ? {} : { workspaceId }) } })
await new Promise(d => setTimeout(d, 2000))
const after = jj('workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\\n"')
  .split('\n')
  .filter(n => n && n !== 'default')
console.log('resume:', resumed.status, '| workspaces after:', after.length, '(was', before + ')')
console.log('activation failures:', /did not activate|failed to import/.test(output) ? 'YES' : 'none')
try {
  process.kill(-child.pid, 'SIGTERM')
} catch {}
