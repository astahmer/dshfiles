import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * End-to-end ADE acceptance against a real Host in a disposable scratch home:
 * does a new coding thread get its own isolated jj workspace, does a resumed
 * thread reuse it, and does ownership hold?
 *
 * Ground truth is the repository itself — a provisioned workspace has to appear
 * in `jj workspace list` — so this does not depend on the plugin's own report.
 *
 * Usage: node scripts/ade-scratch-verify.mjs [out.json]
 */
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const out = process.argv[2] ?? '/tmp/ade-scratch.json'
const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(
  new URL('../tooling/dshx/packages/dshx/dist/project/scratch-profile.js', import.meta.url).href
)
const { connectDshPlatformClient } = await import(new URL('../tooling/dshx/packages/dshx/dist/platform/index.js', import.meta.url).href)

const scratch = await createScratchProfile({
  profileName: 'ade-verify',
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/jj-integration'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies: { '@dshfiles/jj-integration': `link:${resolve(repoRoot, 'plugins/@dshfiles/jj-integration')}` },
})
await scratch.install()

// Provisioning places a thread workspace inside the repository its Session cwd
// belongs to, so the scratch project has to be a real jj repository with a spine.
const project = resolve(scratch.home, 'project')
await mkdir(project, { recursive: true })
const jjConfig = resolve(scratch.home, 'jj-config.toml')
await writeFile(jjConfig, '[user]\nname = "ADE Verify"\nemail = "ade@example.com"\n', { mode: 0o600 })
const jjEnv = { ...process.env, JJ_CONFIG: jjConfig }
const jj = (...args) => execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd: project, env: jjEnv, encoding: 'utf8' })
jj('git', 'init', '.')
await writeFile(resolve(project, 'base.txt'), 'base\n')
jj('describe', '-m', 'base')
jj('bookmark', 'create', 'integration-spine', '-r', jj('log', '-r', '@', '--no-graph', '-T', 'commit_id').trim())
jj('new')
const jjWorkspaces = () =>
  jj('workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\\n"')
    .split('\n')
    .filter(name => name.length > 0 && name !== 'default')

const environment = isolatedHostEnvironment(scratch.home, scratch.profileRoot)
let output = ''
const child = spawn('dsh', ['ade-verify', '--port', '0', '--no-open'], { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
child.stdout.on('data', chunk => (output += chunk.toString('utf8')))
child.stderr.on('data', chunk => (output += chunk.toString('utf8')))

const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/
const evidence = { home: scratch.home, checks: [], jjWorkspaces: [] }
const finish = async code => {
  evidence.hostLog = redactHostOutput(output)
    .split('\n')
    .filter(line => /did not activate|failed to import|workspace/i.test(line))
    .slice(-40)
  await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`)
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {}
  process.exit(code)
}

try {
  const started = Date.now()
  while (!urlPattern.test(output)) {
    if (Date.now() - started > 90_000 || child.exitCode !== null) throw new Error(`host not ready\n${redactHostOutput(output.slice(-3000))}`)
    await new Promise(done => setTimeout(done, 200))
  }
  await new Promise(done => setTimeout(done, 1500))
  const launchUrl = output.match(urlPattern)[0]
  const platform = await connectDshPlatformClient({ url: launchUrl })

  // The typed client exposes no generic RPC, so plugin and workspace APIs go
  // over the same authenticated HTTP envelope the client itself uses.
  const parsedUrl = new URL(launchUrl)
  const index = await fetch(launchUrl, { redirect: 'manual' })
  const cookie = index.headers.getSetCookie?.()[0] ?? index.headers.get('set-cookie')
  const rpc = async (namespace, method, args) => {
    const response = await fetch(`${parsedUrl.origin}/api/${namespace}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${namespace}/${method}`, payload: { args } }),
    })
    const body = await response.text()
    if (response.status !== 200) return { error: `HTTP ${response.status}: ${body.slice(0, 200)}` }
    const envelope = JSON.parse(body)
    return envelope?.result?.value ?? envelope?.result ?? envelope
  }

  // The failing path: a thread created from a project passes that project's
  // workspaceId, so session.create attaches the Session to a workspace. The
  // resolver then places it in its own directory, and the attach must follow the
  // resolved directory rather than reject the placement.
  const workspaceId = await rpc('workspace', 'list', {}).then(value => value?.workspaces?.[0]?.id ?? value?.items?.[0]?.id)
  evidence.workspaceId = workspaceId
  const sessions = ['session-ade-alpha', 'session-ade-beta']
  for (const sessionId of sessions) {
    const created = await rpc('session', 'create', { request: { sessionId, ...(workspaceId === undefined ? {} : { workspaceId }) } })
    evidence.checks.push({
      name: `create-${sessionId}`,
      ok: created?.error === undefined && created?.sessionId === sessionId,
      detail: JSON.stringify(created).slice(0, 200),
    })
  }
  await new Promise(done => setTimeout(done, 5000))

  const provisioned = jjWorkspaces()
  evidence.jjWorkspaces = provisioned
  evidence.checks.push({ name: 'workspaces-provisioned', ok: provisioned.length >= 2, detail: `${provisioned.length}: ${provisioned.join(', ') || '(none)'}` })
  evidence.checks.push({
    name: 'distinct-per-thread',
    ok: new Set(provisioned).size === provisioned.length && provisioned.length >= 2,
    detail: `${new Set(provisioned).size} distinct name(s)`,
  })

  // Resume: the same thread must keep the workspace it already had.
  await platform.sessions.create({ sessionId: 'session-ade-alpha' })
  await new Promise(done => setTimeout(done, 3000))
  const afterResume = jjWorkspaces()
  evidence.checks.push({
    name: 'resume-reuses-workspace',
    ok: afterResume.length === provisioned.length,
    detail: `${afterResume.length} after resume, was ${provisioned.length}`,
  })
  evidence.checks.push({ name: 'no-activation-failures', ok: !/did not activate|failed to import/.test(output), detail: 'host boot output' })

  await finish(evidence.checks.every(check => check.ok) ? 0 : 1)
} catch (error) {
  evidence.error = String(error).slice(0, 2000)
  await finish(1)
}
