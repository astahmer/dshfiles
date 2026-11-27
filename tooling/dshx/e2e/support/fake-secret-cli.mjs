#!/usr/bin/env node
// A stand-in for the `secret` CLI the secret-catalog Host drives: the same argv, one JSON store beside this script,
// synthetic test values only. Aliases map to vault items, so `unset` drops an alias while `rm` also deletes its item.
import { existsSync, linkSync, mkdirSync, realpathSync, statSync } from 'node:fs'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const storePath = join(dirname(fileURLToPath(import.meta.url)), 'store.json')

// The Catalog keys its metadata cache on the stat of the global config the real CLI reads. This fake keeps everything
// in store.json instead, so in a scratch home (always under the temp directory) it hard-links that config to the store:
// every write to the store, by this fake or by a test step, then changes the stat the Host reads. A hard link is not a
// symlink, so the symlinked-config check stays quiet; a real or existing config is never touched.
const linkGlobalConfigToStore = () => {
  const config = join(homedir(), '.config', 'secret', 'config.json')
  try {
    if (!(realpathSync(homedir()) + sep).startsWith(realpathSync(tmpdir()) + sep) || existsSync(config)) return
    mkdirSync(dirname(config), { recursive: true })
    if (statSync(storePath).isFile()) linkSync(storePath, config)
  } catch {
    // A home the fake cannot link only loses cache invalidation for direct store edits.
  }
}
linkGlobalConfigToStore()
const store = JSON.parse(readFileSync(storePath, 'utf8'))
const save = () => writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`)
const fail = message => {
  process.stderr.write(`secret: ${message}\n`)
  process.exit(1)
}

const [command, ...rest] = process.argv.slice(2)
const flags = {}
const positional = []
for (let index = 0; index < rest.length; index += 1) {
  const token = rest[index]
  if (!token.startsWith('--')) positional.push(token)
  else if (['--global', '--all', '--json', '--force', '--generate', '--copy'].includes(token)) flags[token.slice(2)] = true
  else flags[token.slice(2)] = rest[++index]
}

const cwd = process.cwd()
const globalConfig = join(homedir(), '.config', 'secret', 'config.json')
const scopeOf = () => {
  if (flags.global === true || flags.config === globalConfig) return { scope: 'global', root: null }
  if (flags.config === join(cwd, '.secret.local.json')) return { scope: 'local', root: cwd }
  if (flags.config !== undefined) fail(`unknown config ${flags.config}`)
  return { scope: 'project', root: cwd }
}
const inScope =
  ({ scope, root }) =>
  row =>
    row.scope === scope && (scope === 'global' || row.root === root)
const environment = flags.env ?? 'prod'
const readStdin = () => readFileSync(0, 'utf8')
const rowView = row => ({
  alias: row.alias,
  scope: row.scope,
  environment: row.environment,
  item: row.item,
  field: row.field,
  source: row.source,
  description: row.name ?? '',
})

if (command === 'print') {
  const rows =
    positional[0] === 'global' ? store.rows.filter(row => row.scope === 'global') : store.rows.filter(row => row.scope === 'global' || row.root === cwd)
  process.stdout.write(JSON.stringify(rows.map(rowView)))
} else if (command === 'get') {
  const matches = store.rows.filter(row => row.alias === positional[0] && row.environment === environment && inScope(scopeOf())(row))
  if (matches.length !== 1) fail(`${positional[0]} not found`)
  const value = store.vault[matches[0].item]
  if (flags.copy === true) {
    store.clipboard = value
    save()
  } else process.stdout.write(`${value}\n`)
} else if (command === 'set') {
  const target = scopeOf()
  const existing = store.rows.find(row => row.alias === positional[0] && row.environment === environment && inScope(target)(row))
  if (existing !== undefined && flags.force !== true) fail(`${positional[0]} already exists`)
  const value = flags.generate === true ? `generated-${Math.random().toString(36).slice(2, 14)}` : readStdin()
  const item = existing?.item ?? `item-${positional[0]}-${environment}-${target.scope}`
  store.vault[item] = value
  if (existing === undefined) {
    store.rows.push({
      alias: positional[0],
      scope: target.scope,
      root: target.root,
      environment,
      item,
      field: flags.field ?? 'password',
      source: flags.source ?? '',
      name: flags.name,
    })
  }
  save()
} else if (command === 'mv') {
  for (const row of store.rows.filter(row => row.alias === positional[0] && inScope(scopeOf())(row))) row.alias = positional[1]
  save()
} else if (command === 'edit') {
  for (const row of store.rows.filter(row => row.alias === positional[0] && row.environment === environment && inScope(scopeOf())(row))) {
    if (flags.name !== undefined) row.name = flags.name
    if (flags.source !== undefined) row.source = flags.source
  }
  save()
} else if (command === 'unset') {
  store.rows = store.rows.filter(row => !(row.alias === positional[0] && inScope(scopeOf())(row)))
  save()
} else if (command === 'rm') {
  const removed = store.rows.filter(row => row.alias === positional[0] && row.environment === environment && inScope(scopeOf())(row))
  store.rows = store.rows.filter(row => !removed.includes(row))
  for (const row of removed) delete store.vault[row.item]
  save()
} else if (command === 'mcp') {
  // Minimal stdio JSON-RPC server: enough for the Host's secret_run path.
  const send = payload => process.stdout.write(`${JSON.stringify(payload)}\n`)
  const scrub = (text, secrets) => secrets.reduce((out, secret) => (secret.length === 0 ? out : out.split(secret).join('[scrubbed]')), text)
  const runTool = arguments_ => {
    const [executable, ...args] = arguments_.command ?? []
    if (executable === undefined) return { exitCode: 1, timedOut: false, stdout: '', stderr: 'no command', injectedAliases: [] }
    const rows = store.rows.filter(row => row.scope === 'global' || row.root === (arguments_.cwd ?? cwd))
    const environment = arguments_.env ?? 'prod'
    const injected = rows.filter(row => row.environment === environment)
    const env = { ...process.env }
    for (const row of injected) env[row.alias] = store.vault[row.item] ?? ''
    const result = spawnSync(executable, args, { cwd: arguments_.cwd ?? cwd, env, encoding: 'utf8' })
    const secrets = injected.map(row => store.vault[row.item] ?? '').filter(value => value.length > 0)
    return {
      exitCode: result.status ?? 1,
      timedOut: false,
      stdout: scrub(result.stdout ?? '', secrets),
      stderr: scrub(result.stderr ?? '', secrets),
      injectedAliases: injected.map(row => row.alias),
    }
  }
  let buffer = ''
  const handle = line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.method === 'initialize')
      return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'secret', version: '2.1.3' } } })
    if (message.method === 'tools/call') {
      const tool = message.params?.name
      const text = tool === 'secret_run' ? JSON.stringify(runTool(message.params?.arguments ?? {})) : JSON.stringify({ error: `unsupported tool ${tool}` })
      return send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text }] } })
    }
  }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.length > 0) handle(line)
    }
  })
} else fail(`unsupported command ${command}`)
