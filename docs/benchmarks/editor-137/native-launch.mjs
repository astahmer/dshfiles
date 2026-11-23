import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { probeNative } from './native-probe.mjs'

const scratch = await realpath(process.cwd())
assert(/\/node_modules\/\.editor-137-repro\/run-[^/]+$/.test(scratch), 'Run through run.mjs.')
const owned = await mkdtemp(join(scratch, 'native-'))
const home = join(owned, 'home')
const dshHome = join(home, '.dsh')
const profile = join(dshHome, 'profiles/web')
const documents = join(owned, 'Documents')
const root = join(documents, 'deepseek-harness/default-workspace')
const entry = join(scratch, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const flags = ['--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open']
const env = { HOME: home, DSH_HOME: dshHome, TMPDIR: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` }

async function verifyLayout() {
  for (const path of [owned, home, dshHome, profile, documents, root, join(root, 'src')]) {
    assert(path === (await realpath(path)) && (path === owned || path.startsWith(`${owned}/`)), 'Native path escaped the scratch directory.')
  }
  // A clean HOME does not control macOS Documents lookup. Refuse both a stored
  // workspace and a missing effective documentsDirectory before starting Web.
  const existing = await lstat(join(dshHome, 'storages/workspace.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  assert(!existing, 'A workspace was already registered before native boot.')
}

function verifyComposition(config) {
  const rows = config.split(/^\s*- id: /m).filter(row => row.startsWith('workspace-controller\n'))
  assert.equal(rows.length, 1, 'Expected exactly one workspace-controller row.')
  const row = rows[0]
  assert(row.includes("name: '@deepseek-ai/dsh-api-workspace-controller'"), 'Unexpected workspace-controller package.')
  const declarations = row.split('\n').filter(line => /^\s*documentsDirectory:/.test(line))
  assert.equal(declarations.length, 1, 'Expected an explicit Documents override.')
  const lines = row.split('\n')
  const index = lines.indexOf(declarations[0])
  const value = declarations[0].trim().slice('documentsDirectory:'.length).trim()
  const decoded = value === '>-' ? lines[index + 1]?.trim() : value.replace(/^(['"])(.*)\1$/, '$2')
  assert(decoded === documents, 'Effective Documents directory is not the scratch fixture.')
}

function waitForAddress(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => done(new Error('Stock DSH did not announce a scratch URL.')), 15_000)
    let buffer = ''
    const done = (error, address) => {
      clearTimeout(timeout)
      child.stdout.off('data', data)
      child.off('exit', exited)
      child.off('error', done)
      if (error) reject(error)
      else resolve(address)
    }
    const exited = () => done(new Error('Stock DSH exited before announcing a scratch URL.'))
    const data = chunk => {
      buffer = (buffer + chunk).slice(-16_384)
      const announced = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?[^\s]+)\r?\n/m.exec(buffer)?.[1]
      if (announced) done(null, announced)
    }
    child.on('exit', exited)
    child.on('error', done)
    child.stdout.setEncoding('utf8').on('data', data)
  })
}

let host
try {
  await mkdir(profile, { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  for (const file of ['sample.ts', 'second.ts']) await copyFile(join(scratch, 'fixture/src', file), join(root, 'src', file))
  await writeFile(
    join(profile, 'cordis.patch.yml'),
    [
      '- id: workspace-controller',
      '  config:',
      `    documentsDirectory: ${JSON.stringify(documents)}`,
      '- id: ui-settings-general',
      '  config:',
      '    welcomeNoticeVersion: 2026-09-28.1',
      '',
    ].join('\n'),
    { flag: 'wx', mode: 0o600 },
  )
  await verifyLayout()
  const { stdout } = await promisify(execFile)(process.execPath, [entry, '--profile', 'web', '--dump-config'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 2_000_000,
  }).catch(() => {
    throw new Error('Could not verify stock scratch composition; not starting Web.')
  })
  verifyComposition(stdout)
  await verifyLayout()
  host = spawn(process.execPath, [entry, ...flags], { cwd: root, env, stdio: ['ignore', 'pipe', 'ignore'] })
  const url = await waitForAddress(host)
  const address = new URL(url)
  assert(address.hostname === '127.0.0.1' && Number(address.port) >= 1024, 'Not an ephemeral loopback port.')
  host.stdout.resume()
  await probeNative({ url, root })
} finally {
  if (host?.pid && host.exitCode === null && host.signalCode === null) {
    const exited = once(host, 'exit')
    const deadline = setTimeout(() => host.kill('SIGKILL'), 5_000)
    host.kill('SIGTERM')
    try {
      await exited
    } finally {
      clearTimeout(deadline)
    }
  }
  assert(owned.startsWith(`${scratch}/native-`) && owned === (await realpath(owned)), 'Refuse cleanup outside scratch.')
  await rm(owned, { recursive: true, force: true })
}
