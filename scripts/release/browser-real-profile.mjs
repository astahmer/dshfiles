/**
 * Browser acceptance using a COPY of the real web profile against the isolated
 * release runtime. The minimal scratch profile cannot load our sidebar plugins;
 * the real profile can, and this never touches the live profile or the live Host.
 */
import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const PLAYWRIGHT = '/Users/astahmer/dev/dsh-core-thread-mention/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'
const RUNTIME = '/private/tmp/dsh-rc-runtime'
const DSH_BIN = `${RUNTIME}/node_modules/@deepseek-ai/dsh/lib/bin.js`
const SRC = resolve(homedir(), '.dsh/profiles/web')
const HOME = '/private/tmp/ade-browser-home'
const SHOTS = '/tmp/ade-browser'

execFileSync('rm', ['-rf', HOME])
await mkdir(resolve(HOME, 'profiles'), { recursive: true })
await cp(SRC, resolve(HOME, 'profiles/web'), { recursive: true, dereference: false })

// The copied profile's link: deps are relative to the original location.
const manifestPath = resolve(HOME, 'profiles/web/package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
let rewritten = 0
for (const [name, spec] of Object.entries(manifest.dependencies)) {
  if (typeof spec !== 'string' || !spec.startsWith('link:')) continue
  // Point at THIS release candidate, not the canonical checkout the live profile
  // links to, so the browser exercises the revision under test.
  const original = resolve(SRC, spec.slice(5))
  const candidate = original.replace('/Users/astahmer/dev/dshfiles/', '/Users/astahmer/dev/dshfiles-release-candidate/')
  manifest.dependencies[name] = `link:${candidate}`
  rewritten += 1
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('rewrote', rewritten, 'profile links to absolute paths')

execFileSync('pnpm', ['install', '--no-frozen-lockfile'], { cwd: resolve(HOME, 'profiles/web'), stdio: 'pipe' })
console.log('profile installed')

const project = resolve(HOME, 'project')
await mkdir(project, { recursive: true })
const jjConfig = resolve(HOME, 'jj-config.toml')
await writeFile(jjConfig, '[user]\nname = "Browser"\nemail = "b@example.com"\n', { mode: 0o600 })
const jjEnv = { ...process.env, JJ_CONFIG: jjConfig }
const jj = (...args) => execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd: project, env: jjEnv, encoding: 'utf8' })
jj('git', 'init', '--colocate', '.')
await writeFile(resolve(project, 'base.txt'), 'base\n')
jj('describe', '-m', 'base')
jj('bookmark', 'create', 'integration-spine', '-r', jj('log', '-r', '@', '--no-graph', '-T', 'commit_id').trim())
jj('new')

let hostOutput = ''
const child = spawn(process.execPath, [DSH_BIN, 'web', '--port', '0', '--no-open'], {
  cwd: project,
  env: { ...process.env, DSH_HOME: HOME, DSHX_BOOT_PROFILE_ROOT: resolve(HOME, 'profiles/web') },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
child.stdout.on('data', c => (hostOutput += c.toString()))
child.stderr.on('data', c => (hostOutput += c.toString()))
const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/
const started = Date.now()
while (!urlPattern.test(hostOutput)) {
  if (Date.now() - started > 150_000) throw new Error(`host not ready\n${hostOutput.slice(-3000)}`)
  await new Promise(d => setTimeout(d, 250))
}
const launchUrl = hostOutput.match(urlPattern)[0]
const failures = hostOutput.split('\n').filter(line => /did not activate|failed to import/.test(line))
console.log('host:', launchUrl.replace(/token=.*/, 'token=<redacted>'))
console.log(
  'activation failures:',
  failures.length === 0
    ? 'none'
    : failures
        .slice(0, 6)
        .map(l => l.trim().slice(0, 160))
        .join('\n  '),
)

const pw = (await import(PLAYWRIGHT)).default
const browser = await pw.chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('console', m => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('pageerror', e => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`))
await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.waitForTimeout(8000)
await page.screenshot({ path: `${SHOTS}/10-real-profile.png` })
const visible = await page.evaluate(() => document.body.innerText).catch(() => '')
console.log('failed-to-load:', visible.includes('Failed to load plugins') ? 'PRESENT' : 'absent')
console.log('visible UI:', visible.replace(/\s+/g, ' ').slice(0, 400))
console.log('console errors:', consoleErrors.length)
for (const e of consoleErrors.slice(0, 6)) console.log('  -', e)
// DSH's first-use Workspace is always <Documents>/deepseek-harness/default-workspace,
// so register the scratch jj project as a Workspace and select it in the composer:
// that is the real journey for a coding thread.
const launchIndex = await fetch(launchUrl, { redirect: 'manual' })
const cookie = launchIndex.headers.getSetCookie?.()[0] ?? launchIndex.headers.get('set-cookie')
const origin = new URL(launchUrl).origin
const rpc = async (ns, method, args) => {
  const response = await fetch(`${origin}/api/${ns}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: `${ns}/${method}`, payload: { args } }),
  })
  const body = await response.text()
  const envelope = response.status === 200 ? JSON.parse(body) : undefined
  return envelope?.result?.value ?? envelope?.result
}
const madeWorkspace = await rpc('workspace', 'create', { request: { path: project, title: 'project' } })
console.log('registered project workspace:', madeWorkspace?.workspace?.workspaceId ?? '(none)')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
// Select the project workspace in the composer's workspace control.
await page
  .getByText('Default workspace')
  .first()
  .click({ timeout: 15_000 })
  .catch(error => console.log('workspace control click failed:', String(error).slice(0, 120)))
await page.waitForTimeout(1200)
await page
  .getByText('project', { exact: true })
  .first()
  .click({ timeout: 10_000 })
  .catch(error => console.log('project option click failed:', String(error).slice(0, 120)))
await page.waitForTimeout(1200)

const before = await page.evaluate(() => document.body.innerText)
const composer = page.locator('textarea, [contenteditable="true"]').first()
await composer.click({ timeout: 15_000 }).catch(() => {})
await composer.fill('reply with the single word: pong').catch(async () => {
  await page.keyboard.type('reply with the single word: pong')
})
await page.keyboard.press('Enter')
await page.waitForTimeout(12_000)
await page.screenshot({ path: `${SHOTS}/11-after-send.png` })
const after = await page.evaluate(() => document.body.innerText)
console.log('sidebar before:', (before.match(/All threads[^|]*/) ?? [''])[0].replace(/\s+/g, ' ').slice(0, 120))
console.log('sidebar after :', (after.match(/All threads[^|]*/) ?? [''])[0].replace(/\s+/g, ' ').slice(0, 120))
console.log('thread appeared in sidebar:', /Working \(1\)|Active \(1\)|pong/i.test(after) ? 'YES' : 'no')
console.log('after-send UI:', after.replace(/\s+/g, ' ').slice(0, 400))
const cwdCheck = execFileSync('jj', ['--color=never', '--no-pager', 'workspace', 'list', '--ignore-working-copy', '-T', 'name ++ "\n"'], {
  cwd: project,
  env: jjEnv,
  encoding: 'utf8',
})
  .split('\n')
  .filter(n => n && n !== 'default')
for (const line of hostOutput
  .split('\n')
  .filter(l => l.includes('ADE-PROBE'))
  .slice(0, 8))
  console.log('HOST', line.trim().slice(0, 220))
console.log('provisioned jj workspaces:', JSON.stringify(cwdCheck))
await writeFile(`${SHOTS}/real-profile.json`, `${JSON.stringify({ failures, visible: visible.slice(0, 2000), consoleErrors }, null, 2)}\n`)
await browser.close()
try {
  process.kill(-child.pid, 'SIGTERM')
} catch {}
console.log('screenshot:', `${SHOTS}/10-real-profile.png`)
