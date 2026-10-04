#!/usr/bin/env node

// End-to-end gate for Client Slot plugins that must actually render in a real
// `dsh web` page. Build-time guards prove a plugin is shaped correctly; this
// proves the browser mounts it, which is the only place the failure the guards
// exist for was previously visible.
//
// Which plugins and which seats to check are both discovered, not listed: every
// installed plugin declaring a `dsh.client`, and every seat its bundle registers,
// so neither a new plugin nor a new seat needs an edit here.
//
//   node scripts/smoke-client-slot.mjs                     # mount tier
//   node scripts/smoke-client-slot.mjs --interact          # + reorder tier
//   node scripts/smoke-client-slot.mjs --slot conversation.input.dock

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const playwrightCli = join(repoRoot, 'node_modules/.bin', `playwright-cli${process.platform === 'win32' ? '.cmd' : ''}`)

/** Fail with the reason rather than an opaque spawn ENOENT. */
const requirePlaywrightCli = () => {
  if (existsSync(playwrightCli)) return playwrightCli
  throw new Error(
    `${playwrightCli} is missing. This gate drives a real browser, so it needs @playwright/cli installed in tooling/dshx.`,
  )
}
const outputDirectory = join(repoRoot, 'output/playwright/smoke-client-slot')
const bootTimeoutMs = 180_000

const parseArguments = argv => {
  const options = { profile: 'web', plugins: [], interact: false, slot: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      const value = argv[(index += 1)]
      if (value === undefined) throw new Error(`${argument} requires a value`)
      return value
    }
    switch (argument) {
      case '--profile':
        options.profile = next()
        break
      case '--plugin':
        options.plugins.push(next())
        break
      case '--slot':
        options.slot = next()
        break
      case '--interact':
        options.interact = true
        break
      case '--help':
        process.stdout.write(
          [
            'Usage: node scripts/smoke-client-slot.mjs [options]',
            '',
            'With no --plugin, every plugin the profile installs that declares a',
            'dsh.client and registers the checked Slot is verified.',
            '',
            '  --profile <name>  dsh profile to boot (default: web)',
            '  --plugin <id>     restrict to this package id (repeatable)',
            '  --slot <name>     restrict to this Slot seat (default: every seat found)',
            '  --interact        also assert reordering (needs a configured model)',
            '',
          ].join('\n'),
        )
        process.exit(0)
        break
      default:
        throw new Error(`Unknown argument ${JSON.stringify(argument)}`)
    }
  }
  return options
}

function run(command, args, options = {}) {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env ?? {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
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
      if (code === 0) resolveResult({ stdout, stderr })
      else rejectResult(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`))
    })
  })
}

const readJson = async path => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve each installed dependency's own manifest through the profile's
 * node_modules, keeping only those that declare a `dsh.client` block.
 */
async function clientPluginManifests(profileRoot) {
  const manifest = await readJson(join(profileRoot, 'package.json'))
  const names = Object.keys({ ...(manifest?.dependencies ?? {}), ...(manifest?.devDependencies ?? {}) })
  const found = []
  for (const name of names) {
    const pluginManifest = await readJson(join(profileRoot, 'node_modules', name, 'package.json'))
    if (pluginManifest?.dsh?.client !== undefined) found.push({ id: name, manifest: pluginManifest })
  }
  return found
}

/** The client bundle export, in both the subpath and conditional forms. */
function clientExport(manifest) {
  const exportsField = manifest?.exports
  if (exportsField === undefined || exportsField === null) return undefined
  // `./client` is a subpath key; `client` is accepted for tolerance.
  const value = exportsField['./client'] ?? exportsField.client
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const nested = value.default ?? value.import ?? value.require
    if (typeof nested === 'string') return nested
    if (typeof nested === 'object' && nested !== null) {
      const inner = nested.default ?? nested.import ?? nested.require
      if (typeof inner === 'string') return inner
    }
  }
  return undefined
}

/**
 * Every Slot seat a plugin's client bundle registers, read from the bundle
 * itself. The failure this gate exists for is per-seat, so enumerating the seats
 * keeps a plugin that occupies several surfaces — or a new seat entirely —
 * covered without an edit here.
 */
async function registeredSlots(profileRoot, manifest) {
  const clientPath = clientExport(manifest)
  if (clientPath === undefined) return []
  let code
  try {
    code = await readFile(join(profileRoot, 'node_modules', manifest.name, clientPath), 'utf8')
  } catch {
    return []
  }
  const seats = new Set()
  // `ctx.slots.register({ name: "seat", … })`, `defineSlot("seat", …)` and
  // `slots.inject("seat", …)` are the registration spellings; all of them put a
  // quoted seat name in the bundle.
  for (const pattern of [/name:\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g, /(?:defineSlot|slots\.inject)\(\s*"([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)"/g]) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] !== undefined) seats.add(match[1])
    }
  }
  return [...seats]
}

const freePort = () =>
  new Promise((resolveResult, rejectResult) => {
    const server = createServer()
    server.on('error', rejectResult)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => {
        resolveResult(port)
      })
    })
  })

async function bootDsh(profile, port) {
  const child = spawn('dsh', ['--profile', profile, '--port', String(port), '--no-open'], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const webUrl = await new Promise((resolveResult, rejectResult) => {
    const timer = setTimeout(() => rejectResult(new Error(`dsh web did not report a URL within ${bootTimeoutMs}ms\n${stdout}\n${stderr}`)), bootTimeoutMs)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      const urls = [...stdout.matchAll(/dsh web:\s+(https?:\/\/\S+)/g)]
      if (urls.length === 0) return
      clearTimeout(timer)
      resolveResult(urls.at(-1)?.[1])
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', rejectResult)
  })
  return {
    url: webUrl,
    close: async () => {
      child.kill('SIGTERM')
      await new Promise(done => {
        child.once('close', done)
        setTimeout(done, 5000)
      })
    },
    output: () => ({ stdout, stderr }),
  }
}

const main = async () => {
  const options = parseArguments(process.argv.slice(2))
  await mkdir(outputDirectory, { recursive: true })
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')

  const profileRoot = join(home, 'profiles', options.profile)
  const discovered =
    options.plugins.length > 0
      ? await Promise.all(options.plugins.map(async id => ({ id, manifest: await readJson(join(profileRoot, 'node_modules', id, 'package.json')) })))
      : await clientPluginManifests(profileRoot)
  // Each plugin is checked against every seat it registers, so a plugin that
  // occupies several surfaces still has each one verified.
  const seatWork = (
    await Promise.all(
      discovered.map(async target => ({
        plugin: target.id,
        seats: (await registeredSlots(profileRoot, target.manifest)).filter(seat => options.slot === null || seat === options.slot),
      })),
    )
  ).flatMap(entry => entry.seats.map(seat => ({ plugin: entry.plugin, seat })))

  if (seatWork.length === 0) {
    process.stdout.write(
      `${JSON.stringify({ profile: options.profile, checked: [], skipped: `no plugin installed in ${options.profile} registers a Slot seat` }, null, 2)}\n`,
    )
    return
  }

  requirePlaywrightCli()
  const port = await freePort()
  const dsh = await bootDsh(options.profile, port)
  const session = `slot-smoke-${process.pid}`
  const command = args => run(playwrightCli, [`-s=${session}`, ...args], { cwd: outputDirectory })
  // `eval --raw` prints the evaluated value as JSON, so a page expression that
  // returns a JSON string arrives quoted and needs one more decode.
  const evaluate = async expression => {
    const printed = (await command(['--raw', 'eval', expression])).stdout.trim()
    return JSON.parse(JSON.parse(printed))
  }
  const failures = []

  try {
    await command(['open', dsh.url])
    await command(['snapshot'])

    const consoleOutput = (await command(['console', 'error'])).stdout
    const errorLines = consoleOutput.split('\n').filter(line => line.startsWith('[ERROR]'))
    if (errorLines.length > 0) failures.push(`console reported ${errorLines.length} error(s):\n${errorLines.join('\n')}`)

    const boot = await evaluate('() => JSON.stringify({ composer: document.querySelectorAll("[data-conversation-region=composer]").length })')
    if (boot.composer === 0) failures.push('the composer never mounted, so no Slot can render')

    if (options.interact) {
      const interaction = await evaluate(`async () => {
        const editor = document.querySelector("[contenteditable=true]")
        if (!editor) return JSON.stringify({ skipped: "no composer editor" })
        editor.focus()
        const send = async (text) => {
          document.execCommand("selectAll")
          document.execCommand("insertText", false, text)
          editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }))
          await new Promise(done => setTimeout(done, 220))
          editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }))
          await new Promise(done => setTimeout(done, 140))
        }
        // A long turn first, so the rest actually wait in the queue instead of
        // being consumed as fast as the model can answer.
        await send("Run this shell command and wait for it: sleep 25")
        await send("aaa first")
        await send("bbb second")
        await new Promise(done => setTimeout(done, 3000))
        const docks = [...document.querySelectorAll("[data-queue-dock]")]
        // A dock with more than one row renders collapsed behind a count header,
        // and its row controls only exist once expanded, so expand before probing.
        for (const dock of docks) {
          const header = [...dock.querySelectorAll("button")].find(button => !button.getAttribute("aria-label"))
          if (header) header.click()
        }
        await new Promise(done => setTimeout(done, 700))
        // Any dock exposing an up/down move control is orderable, so this tier
        // does not depend on one plugin's aria-label wording.
        const moveLabel = button => (button.getAttribute("aria-label") ?? button.textContent ?? "").trim()
        const isUpControl = button => /(move.*up|up.*move|\u2191)/i.test(moveLabel(button))
        const plugin = docks.find(dock => [...dock.querySelectorAll("button")].some(isUpControl))
        if (!plugin) return JSON.stringify({ mounted: false, docks: docks.map(dock => dock.textContent.trim().slice(0, 80)) })
        const order = () => [...plugin.querySelectorAll("li")].map(row => row.querySelector("span:nth-child(2)")?.textContent.trim().slice(0, 8))
        const before = order()
        if (before.length < 2) return JSON.stringify({ mounted: true, skipped: \`fewer than two queued messages (\${before.length})\` })
        const upButtons = [...plugin.querySelectorAll("li")].map(row => [...row.querySelectorAll("button")].find(isUpControl))
        upButtons[1]?.click()
        await new Promise(done => setTimeout(done, 1800))
        return JSON.stringify({ mounted: true, rows: before.length, before, after: order() })
      }`)
      if (!interaction.mounted) failures.push(`no dock with reorder controls rendered: ${JSON.stringify(interaction.docks)}`)
      else if (interaction.skipped === undefined && JSON.stringify(interaction.before) === JSON.stringify(interaction.after))
        failures.push(`the move control did not change the order: ${JSON.stringify(interaction)}`)
      else if (interaction.skipped !== undefined) failures.push(`reorder tier skipped: ${interaction.skipped}`)
    }

    await command(['close']).catch(() => {})
  } finally {
    await command(['close']).catch(() => {})
    await dsh.close()
  }

  const report = {
    profile: options.profile,
    seatFilter: options.slot,
    interact: options.interact,
    checked: seatWork,
    failures,
  }
  await writeFile(join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (failures.length > 0) process.exitCode = 1
}

await main()
