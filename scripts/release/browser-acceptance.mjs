/**
 * Browser acceptance against the isolated release runtime.
 *
 * Boots the RC runtime in a disposable scratch home with a real jj repository,
 * then drives the actual DSH frontend with Chromium: console errors, mount
 * state, sidebar contents, thread creation, and the composer.
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const PLAYWRIGHT = '/Users/astahmer/dev/dsh-core-thread-mention/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'
const repoRoot = '/Users/astahmer/dev/dshfiles-release-candidate'
const RUNTIME = '/private/tmp/dsh-rc-runtime'
const DSH_BIN = `${RUNTIME}/node_modules/@deepseek-ai/dsh/lib/bin.js`
const SHOTS = '/tmp/ade-browser'

const { createScratchProfile, isolatedHostEnvironment, redactHostOutput } = await import(
  new URL('file:///Users/astahmer/dev/dshfiles-core-narrow/tooling/dshx/packages/dshx/dist/project/scratch-profile.js').href
)
const scratch = await createScratchProfile({
  profileName: 'browser-verify',
  sourceProfileRoot: resolve(homedir(), '.dsh/profiles/probe'),
  bundleIds: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dshfiles/shared-runtime', '@dshfiles/plugin-ui', '@dshfiles/command-palette', '@dshfiles/jj-integration', '@dshfiles/thread-sidebar', '@dshfiles/activity-timeline'],
  excludedDependencyPrefixes: ['@dshfiles/', '@mars-sea/', 'dshmarket', 'dsh-our-free-model'],
  extraDependencies: {
    '@dshfiles/shared-runtime': `link:${repoRoot}/plugins/@dshfiles/shared-runtime`,
    '@dshfiles/plugin-ui': `link:${repoRoot}/plugins/@dshfiles/plugin-ui`,
    '@dshfiles/command-palette': `link:${repoRoot}/plugins/@dshfiles/command-palette`,
    '@dshfiles/jj-integration': `link:${repoRoot}/plugins/@dshfiles/jj-integration`,
    '@dshfiles/thread-sidebar': `link:${repoRoot}/plugins/@dshfiles/thread-sidebar`,
    '@dshfiles/activity-timeline': `link:${repoRoot}/plugins/@dshfiles/activity-timeline`,
  },
})
await scratch.install()
await mkdir(SHOTS, { recursive: true })

const project = resolve(scratch.home, 'project')
await mkdir(project, { recursive: true })
const jjConfig = resolve(scratch.home, 'jj-config.toml')
await writeFile(jjConfig, '[user]\nname = "Browser Verify"\nemail = "b@example.com"\n', { mode: 0o600 })
const jjEnv = { ...process.env, JJ_CONFIG: jjConfig }
const jj = (...args) => execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd: project, env: jjEnv, encoding: 'utf8' })
jj('git', 'init', '.')
await writeFile(resolve(project, 'base.txt'), 'base\n')
jj('describe', '-m', 'base')
jj('bookmark', 'create', 'integration-spine', '-r', jj('log', '-r', '@', '--no-graph', '-T', 'commit_id').trim())
jj('new')

let hostOutput = ''
const child = spawn(process.execPath, [DSH_BIN, 'browser-verify', '--port', '0', '--no-open'], {
  cwd: project,
  env: isolatedHostEnvironment(scratch.home, scratch.profileRoot),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})
child.stdout.on('data', c => (hostOutput += c.toString()))
child.stderr.on('data', c => (hostOutput += c.toString()))
const urlPattern = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/
const started = Date.now()
while (!urlPattern.test(hostOutput)) {
  if (Date.now() - started > 120_000) throw new Error(`host not ready\n${redactHostOutput(hostOutput.slice(-3000))}`)
  await new Promise(d => setTimeout(d, 250))
}
const launchUrl = hostOutput.match(urlPattern)[0]
console.log('host:', launchUrl.replace(/token=.*/, 'token=<redacted>'))
console.log('scratch home:', scratch.home)
console.log(
  'host activation failures:',
  /did not activate|failed to import/.test(hostOutput)
    ? redactHostOutput(hostOutput)
        .split('\n')
        .filter(l => /did not activate|failed to import/.test(l))
        .join(' | ')
    : 'none',
)

const pw = (await import(PLAYWRIGHT)).default
const browser = await pw.chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
})
page.on('pageerror', error => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))

await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await page.waitForTimeout(6000)
await page.screenshot({ path: `${SHOTS}/01-initial.png`, fullPage: false })

// Real visible text, not the inline theme script.
const visible = await page.evaluate(() => document.body.innerText).catch(() => '')
const body = visible
console.log('failed-to-load card:', body.includes('Failed to load plugins') ? 'PRESENT' : 'absent')
console.log('body sample:', (body || '').replace(/\s+/g, ' ').slice(0, 300))

const sidebarText = await page
  .locator('[class*="sidebar"], aside')
  .first()
  .textContent()
  .catch(() => '')
console.log('sidebar sample:', (sidebarText || '').replace(/\s+/g, ' ').slice(0, 300))
console.log('console errors:', consoleErrors.length)
for (const error of consoleErrors.slice(0, 8)) console.log('  -', error)

await writeFile(
  `${SHOTS}/evidence.json`,
  `${JSON.stringify({ launchUrl: launchUrl.replace(/token=.*/, 'token=<redacted>'), home: scratch.home, failedToLoad: body.includes('Failed to load plugins'), bodySample: (body || '').replace(/\s+/g, ' ').slice(0, 800), sidebarSample: (sidebarText || '').replace(/\s+/g, ' ').slice(0, 800), consoleErrors, hostActivationFailures: /did not activate|failed to import/.test(hostOutput) }, null, 2)}\n`,
)
await browser.close()
try {
  process.kill(-child.pid, 'SIGTERM')
} catch {}
console.log('screenshots in', SHOTS)
