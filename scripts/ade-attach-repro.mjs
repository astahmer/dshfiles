import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const repoRoot = '/Users/astahmer/dev/dshfiles-core-narrow'
const globalController =
  '/Users/astahmer/.local/share/pnpm/global/v11/1502-18da8e8f704b48b8-0/node_modules/.pnpm/@deepseek-ai+dsh-api-session-controller@0.2.0-rc.2_17d7a38790346cf58761755423db9cf6/node_modules/@deepseek-ai/dsh-api-session-controller'
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(
  new URL('file://' + repoRoot + '/tooling/dshx/packages/dshx/dist/project/scratch-profile.js').href
)

// A patched COPY of the deployed controller: same package, with the attach fix
// applied to its built output. Production is never touched.
const patchedRoot = '/tmp/ade-patched-controller'
await cp(globalController, patchedRoot, { recursive: true, force: true })
const libPath = resolve(patchedRoot, 'lib/index.js')
let lib = await readFile(libPath, 'utf8')
const before = lib
lib = lib.replace(
  `\t\tif (workspace !== void 0) try {
\t\t\tawait workspace.attachSession(sessionId);`,
  `\t\tif (workspace !== void 0) try {
\t\t\tconst owner = cwd === workspace.path ? workspace : await this.ctx.workspaceRegistry.resolveByPath(cwd).catch(() => void 0);
\t\t\tawait owner?.attachSession(sessionId);`,
)
if (lib === before) throw new Error('attach fix did not apply to the deployed lib; pattern changed')
await writeFile(libPath, lib)
console.log('patched controller copy at', patchedRoot)

const scratch = await createScratchProfile({
  profileName: 'attach-verify',
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/jj-integration'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies: {
    '@dshfiles/jj-integration': `link:${repoRoot}/plugins/@dshfiles/jj-integration`,
    '@deepseek-ai/dsh-api-session-controller': `link:${patchedRoot}`,
  },
})
await scratch.install()

const project = resolve(scratch.home, 'project')
await mkdir(project, { recursive: true })
const jjConfig = resolve(scratch.home, 'jj-config.toml')
await writeFile(jjConfig, '[user]\nname = "Attach Verify"\nemail = "a@example.com"\n', { mode: 0o600 })
const jjEnv = { ...process.env, JJ_CONFIG: jjConfig }
const jj = (...args) => execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd: project, env: jjEnv, encoding: 'utf8' })
jj('git', 'init', '.')
await writeFile(resolve(project, 'base.txt'), 'base\n')
jj('describe', '-m', 'base')
jj('bookmark', 'create', 'integration-spine', '-r', jj('log', '-r', '@', '--no-graph', '-T', 'commit_id').trim())
jj('new')

let output = ''
const child = spawn('dsh', ['attach-verify', '--port', '0', '--no-open'], {
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
  return { status: response.status, body: await response.text() }
}
// The UI takes workspaceId from the workspace registry, so create one the same
// way the registry does rather than hunting for a list endpoint.
const made = await rpc('workspace', 'create', { request: { path: project, title: 'dshfiles' } })
console.log('workspace/create:', made.status, made.body.slice(0, 240))
const madeEnvelope = made.status === 200 ? JSON.parse(made.body) : undefined
const madeValue = madeEnvelope?.result?.value ?? madeEnvelope?.result
const workspaceId = madeValue?.workspace?.workspaceId ?? madeValue?.workspace?.id ?? madeValue?.workspaceId ?? madeValue?.id
console.log('workspaceId:', workspaceId ?? '(none)')

const created = await rpc('session', 'create', { request: { sessionId: 'session-attach-probe', ...(workspaceId === undefined ? {} : { workspaceId }) } })
console.log('session/create:', created.status, created.body.slice(0, 300))
const workspaces = jj('workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\\n"')
  .split('\n')
  .filter(n => n && n !== 'default')
console.log('provisioned jj workspaces:', JSON.stringify(workspaces))
try {
  process.kill(-child.pid, 'SIGTERM')
} catch {}
process.exit(created.status === 200 ? 0 : 1)
