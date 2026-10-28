import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { LauncherConfig } from './launcher-config.mjs'
import { dirname, join, resolve } from 'node:path'
import { prepareComposedBootProfile } from '../tooling/dshx/packages/dshx/dist/project/boot-profile.js'
import { findFreePort } from '../tooling/dshx/packages/dshx/dist/project/local-bundles.js'
import { ScratchProfileRuntime } from '../tooling/dshx/packages/dshx/dist/project/scratch-profile.js'
import { ScratchSeedRuntime } from '../tooling/dshx/packages/dshx/dist/scratch/seed.js'
import { StartupDialogs } from '../tooling/dshx/packages/dshx/dist/project/startup-dialogs.js'

// This smoke deliberately reads only the live profile's manifest and pnpm policy,
// never its private patch, account files, credentials, workspace storage or sessions.
const config = LauncherConfig.load()
const root = config.sourceRoot
const home = config.dshHome
const profileRoot = join(home, 'profiles', config.profile)
const node = config.nodeBinary
const core = LauncherConfig.requireCoreEntry(config)
const require = createRequire(join(root, 'tooling/dshx/package.json'))
const { chromium } = require('@playwright/test')
const manifest = JSON.parse(await readFile(join(profileRoot, 'package.json'), 'utf8'))
const bundles = manifest.dsh.profile.bundles
  .filter(name => name.startsWith('@dshfiles/'))
  .map(packageId => ({
    packageId,
    projectRoot: join(root, 'plugins', packageId),
  }))
const scratch = await mkdtemp(join(tmpdir(), 'dsh-upstream-verify-'))
const bin = join(scratch, 'bin')
await mkdir(bin, { mode: 0o700 })
// Bypass any external wrapper while preserving the scratch environment.
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
await writeFile(join(bin, 'dsh'), `#!/bin/sh\nexec ${shellQuote(node)} ${shellQuote(core)} "$@"\n`, { mode: 0o700 })
const previousPath = process.env.PATH
process.env.PATH = `${bin}:${previousPath ?? ''}`
let prepared
let host
let browser
let output = ''
const errors = []
const redact = text => text.replace(/https?:\/\/[^\s"'<>]+/g, '[url redacted]')
const evidence = join(home, 'verification', new Date().toISOString().replaceAll(':', '-'))
await mkdir(evidence, { recursive: true, mode: 0o700 })
try {
  prepared = await prepareComposedBootProfile(bundles, {
    sourceProfileRoot: profileRoot,
    includeSourceProfileBundles: true,
    cordisPatch: '- id: hmr\n  disabled: true\n',
  })
  const fakeBin = await ScratchSeedRuntime.installFakeSecretCli({ home: prepared.homeRoot, project: root })
  const environment = ScratchProfileRuntime.hostEnvironment(prepared.homeRoot, prepared.profileRoot, { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` })
  if (resolve(environment.DSH_HOME) === resolve(home)) throw new Error('Refusing live DSH_HOME')
  const port = await findFreePort()
  host = spawn(node, [core, '--profile', prepared.profile, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    cwd: root,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const launchUrl = await new Promise((resolveUrl, reject) => {
    const timer = setTimeout(() => reject(new Error('Scratch Host did not announce its URL in 90 seconds')), 90_000)
    const collect = chunk => {
      output += String(chunk)
      const url = /http:\/\/127\.0\.0\.1:\d+\/\S*/.exec(output)?.[0]
      if (url) {
        clearTimeout(timer)
        resolveUrl(url)
      }
    }
    host.stdout.on('data', collect)
    host.stderr.on('data', collect)
    host.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    host.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`Scratch Host exited before readiness: ${code}`))
    })
  })
  const browserOptions = { headless: true }
  if (config.browserExecutable) browserOptions.executablePath = config.browserExecutable
  browser = await chromium.launch(browserOptions)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(redact(error.message)))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(redact(message.text()))
  })
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await StartupDialogs.dismissPreviewNotice(page, 10_000)
  await StartupDialogs.dismissProviderSetupDuringStartup(page, 10_000)
  await page.getByRole('button', { name: 'New thread', exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })
  const slotErrors = await page.locator('[data-slot-error]').count()
  const failureCard = await page.getByText('Failed to load plugins', { exact: false }).count()
  const activationFailures = output
    .split('\n')
    .filter(line => /did not activate|failed to import|fatal uncaught exception|ERR_MODULE_NOT_FOUND/.test(line))
    .map(redact)
  await page.screenshot({ path: join(evidence, 'candidate.png'), fullPage: true })
  const summary = {
    selectedOwnedBundles: bundles.length,
    origin: new URL(launchUrl).origin,
    isolatedHome: true,
    fakeSecrets: true,
    slotErrors,
    failureCard,
    activationFailures,
    browserErrors: errors,
    privateProfileConfigTested: false,
    screenshot: join(evidence, 'candidate.png'),
  }
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  await chmod(join(evidence, 'candidate.png'), 0o600)
  console.log(JSON.stringify(summary, null, 2))
  if (slotErrors || failureCard || activationFailures.length || errors.length) process.exitCode = 1
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : 'Scratch validation failed'))
  const failure = { error: redact(error instanceof Error ? error.message : 'Unknown failure'), hostOutput: redact(output), browserErrors: errors }
  await writeFile(join(evidence, 'failure.json'), JSON.stringify(failure, null, 2) + '\n', { mode: 0o600 })
  console.error(`Redacted evidence: ${join(evidence, 'failure.json')}`)
  process.exitCode = 1
} finally {
  if (browser)
    await browser.close().catch(error => {
      console.error(`Browser cleanup: ${redact(String(error))}`)
      process.exitCode = 1
    })
  if (host?.pid && host.exitCode === null) {
    await new Promise(resolveExit => {
      const timer = setTimeout(() => {
        try {
          process.kill(-host.pid, 'SIGKILL')
        } catch {}
        resolveExit()
      }, 5_000)
      host.once('exit', () => {
        clearTimeout(timer)
        resolveExit()
      })
      try {
        process.kill(-host.pid, 'SIGTERM')
      } catch {
        clearTimeout(timer)
        resolveExit()
      }
    })
  }
  if (prepared)
    await prepared.dispose().catch(error => {
      console.error(`Profile cleanup: ${redact(String(error))}`)
      process.exitCode = 1
    })
  if (previousPath === undefined) delete process.env.PATH
  else process.env.PATH = previousPath
  if (dirname(resolve(scratch)) !== resolve(tmpdir()) || !scratch.startsWith(join(resolve(tmpdir()), 'dsh-upstream-verify-'))) {
    console.error('Unexpected scratch cleanup path; refusing removal')
    process.exitCode = 1
  } else await rm(scratch, { recursive: true, force: true })
}
