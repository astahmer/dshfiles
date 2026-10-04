#!/usr/bin/env node

// Attach to a running `dsh web` and report what the page actually rendered.
// Read-only: it boots nothing, edits nothing, and touches no DSH source. Its
// job is to replace "open DevTools and paste me the console" with evidence the
// agent can collect alone.
//
//   node scripts/dsh-web-probe.mjs --url 'http://127.0.0.1:3080/?token=…' \
//     --console error --selector '[data-queue-dock]' --timeout 20000
//
// `--console` and `--requests` take playwright-cli's own filters, so
// `--console error` reports only errors and `--console` reports everything.
//
// `dsh web` mints its browser session from the launch token and keeps it in a
// cookie, so the first probe needs the token and later probes do not:
// `--keep-open` reuses one named `--session` across probes and skips the token.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const playwrightCli = join(repoRoot, 'tooling/dshx/node_modules/.bin', `playwright-cli${process.platform === 'win32' ? '.cmd' : ''}`)

/** Fail with the reason rather than an opaque spawn ENOENT. */
const requirePlaywrightCli = () => {
  if (existsSync(playwrightCli)) return playwrightCli
  throw new Error(
    `${playwrightCli} is missing. This probe drives a real browser, so it needs @playwright/cli installed in tooling/dshx.`,
  )
}
const outputDirectory = join(repoRoot, 'output/playwright/dsh-web-probe')

const parseArguments = argv => {
  const options = { timeout: 20000, selector: null, console: null, requests: false, evaluate: null, reload: false, session: 'dsh-probe', screenshot: false, keepOpen: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${argument} requires a value`)
      return value
    }
    switch (argument) {
      case '--url':
        options.url = next()
        break
      case '--session':
        options.session = next()
        break
      case '--screenshot':
        options.screenshot = true
        break
      case '--keep-open':
        options.keepOpen = true
        break
      case '--selector':
        options.selector = next()
        break
      case '--console':
        options.console = next()
        break
      case '--evaluate':
        options.evaluate = next()
        break
      case '--timeout':
        options.timeout = Number(next())
        break
      case '--requests':
        options.requests = true
        break
      case '--reload':
        options.reload = true
        break
      case '--help':
        process.stdout.write(
          [
            'Usage: node scripts/dsh-web-probe.mjs --url <web-url> [options]',
            '',
            '  --console <min-level>   capture browser console messages at that level',
            '  --requests              list network requests made while the page loaded',
            '  --selector <css>        count matching elements and read their text',
            '  --evaluate <expression>  evaluate a page expression and print its result',
            '  --reload                reload before probing, to capture boot-time console output',
            '  --timeout <ms>          selector wait budget',
            '  --session <name>        browser session to reuse; keeps the dsh web auth cookie',
            '  --screenshot            write a PNG of the page and report its file name',
            '  --keep-open             leave the browser open so the next probe reuses the session',
            '',
          ].join('\n'),
        )
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${JSON.stringify(argument)}`)
    }
  }
  if (options.url === undefined) throw new Error('--url is required')
  return options
}

function run(args, cwd) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(playwrightCli, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', rejectResult)
    child.once('close', code => {
      if (code === 0) resolveResult(stdout)
      else rejectResult(new Error(`playwright-cli ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`))
    })
  })
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  requirePlaywrightCli()
  await mkdir(outputDirectory, { recursive: true })
  const session = options.session
  const command = args => run([`-s=${session}`, ...args], outputDirectory)
  const report = { url: options.url.replace(/token=[^&]+/, 'token=<redacted>'), session }

  try {
    // A session that already holds the dsh web cookie is navigated straight to
    // the clean URL: opening the token URL again restarts the cookie exchange
    // and drops the session the caller wanted to reuse.
    const authenticated = await command(['--raw', 'eval', `() => document.title + '|' + document.body.innerText.slice(0, 40)`])
      .catch(() => '')
    const alreadyOpen = authenticated.includes('AI Accounts')
    if (alreadyOpen) {
      const target = new URL(options.url)
      target.searchParams.delete('token')
      await command(['goto', target.href])
    } else {
      await command(['open', options.url])
    }
    if (options.reload && alreadyOpen) await command(['reload'])
    await command(['snapshot'])

    const selector = options.selector ?? 'body'
    if (options.selector !== null) {
      // A selector that never appears is itself the finding, so a failed wait is
      // reported as evidence instead of aborting the probe.
      report.selectorWait = await command([
        'run-code',
        `async (page) => { await page.waitForSelector(${JSON.stringify(selector)}, { state: 'attached', timeout: ${options.timeout} }).then(() => 'attached').catch(error => 'absent: ' + error.message.split('\\n')[0]) }`,
      ]).catch(error => `absent: ${error.message.split('\n')[0]}`)
    }
    report.selector = selector
    report.elements = JSON.parse(
      await command([
        '--raw',
        'eval',
        `() => JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].map(node => ({ tag: node.tagName, rows: node.querySelectorAll('li').length, text: (node.textContent ?? '').trim().slice(0, 300) })))`,
      ]),
    )

    if (options.console !== null) report.console = await command(['console', options.console])
    if (options.requests) report.requests = await command(['requests'])
    if (options.evaluate !== null) report.evaluate = await command(['--raw', 'eval', options.evaluate])
    if (options.screenshot) {
      const taken = await command(['screenshot'])
      report.screenshot = taken.match(/[\w.-]+\.png/)?.[0] ?? taken.trim()
    }
  } finally {
    // The dsh web auth cookie lives in the browser profile, so closing here would
    // discard it and force a fresh token on every probe. `--keep-open` reuses the
    // authenticated session across probes.
    if (!options.keepOpen) await command(['close']).catch(() => {})
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

await main()
