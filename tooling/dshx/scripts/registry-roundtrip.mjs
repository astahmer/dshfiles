#!/usr/bin/env node
/**
 * Registry round trip against the real toolchain: a plugin from `dshx create`,
 * real `dsh`, real pnpm, a loopback HTTP registry, real boots in a throwaway
 * DSH_HOME. tests/registry.spec.ts covers the rules with a fake `dsh`; this proves
 * the profile that results actually loads, and that the npm path still works.
 *
 * Needs a built dshx, `dsh` on PATH and npm network access. Never touches the
 * caller's DSH home or a running DSH.
 *
 *   node tooling/dshx/scripts/registry-roundtrip.mjs [--keep]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** The steps below block on spawnSync, so the registry needs an event loop of its own. */
if (process.argv[2] === '--serve') {
  const root = process.argv[3]
  const server = createServer((request, response) => {
    const path = join(root, new URL(request.url, 'http://x').pathname)
    if (!path.startsWith(root) || !existsSync(path)) {
      response.statusCode = 404
      response.end()
      return
    }
    response.end(readFileSync(path))
  })
  server.listen(0, '127.0.0.1', () => console.log(server.address().port))
  await new Promise(() => {})
}

const PLUGIN = 'registry-mini'
/** Named for its template: the shipped `web` template brings the surface a boot needs. The home is throwaway. */
const PROFILE = 'web'
const NPM_PLUGIN = 'dsh-plugin-example'
/** Old enough that pnpm's release-age quarantine lets `update --latest` move past it; newer releases need naming. */
const NPM_FROM = '0.1.1'
const NPM_PINNED = '0.1.4'
const FAILURE_MARKERS = ['did not activate', 'failed to import', 'Failed to load plugins', 'fatal uncaught exception']

const dshxBin = resolve(import.meta.dirname, '../packages/dshx/dist/cli/bin.js')
if (!existsSync(dshxBin)) throw new Error(`Build dshx first: ${dshxBin} is missing.`)

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'dshx-registry-roundtrip-')))
const home = join(scratch, 'home')
const project = join(scratch, PLUGIN)
const site = join(scratch, 'site')
const profileRoot = join(home, 'profiles', PROFILE)
const env = { ...process.env, DSH_HOME: home }
const results = []

const check = (label, passed, detail = '') => {
  results.push({ label, passed })
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!passed) throw new Error(`Failed: ${label}`)
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024, ...options })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const dshx = (...args) => run(process.execPath, [dshxBin, ...args])
const inProfile = ['--profile', PROFILE, '--home', home]
const profileManifest = () => JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'))
const installedVersion = name => {
  const path = join(profileRoot, 'node_modules', name, 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).version : null
}

/** pnpm drops an empty `dependencies`, so compare what the profile selects rather than the file's bytes. */
const selection = manifest => JSON.stringify([manifest.dependencies ?? {}, manifest.dsh.profile.bundles])

const freePort = () =>
  new Promise(done => {
    const server = createNetServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })

/** Boot the scratch profile and read what the Host reports, then stop that process group. */
const bootAndList = async () => {
  const port = await freePort()
  const child = spawn('dsh', ['--profile', PROFILE, '--port', String(port), '--no-open'], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => (output += String(chunk)))
  child.stderr.on('data', chunk => (output += String(chunk)))
  try {
    const started = Date.now()
    let url
    while (url === undefined && Date.now() - started < 90_000 && child.exitCode === null) {
      await new Promise(done => setTimeout(done, 250))
      url = /https?:\/\/\S*token=\S+/u.exec(output)?.[0]
    }
    if (url === undefined) throw new Error(`The scratch DSH never printed its URL:\n${output.slice(-2000)}`)
    await new Promise(done => setTimeout(done, 3000))
    const listed = dshx('plugins', 'list', '--json', '--url', url)
    return { output, listed: listed.output }
  } finally {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}

const assertBoots = async (label, shouldLoad) => {
  const { output, listed } = await bootAndList()
  const failures = FAILURE_MARKERS.filter(marker => output.includes(marker))
  check(`${label}: boots without an activation failure`, failures.length === 0, failures.join(', '))
  check(`${label}: Host ${shouldLoad ? 'runs' : 'no longer lists'} ${PLUGIN}`, listed.includes(PLUGIN) === shouldLoad)
}

const setVersion = version => {
  const path = join(project, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`)
}

const publish = version => {
  setVersion(version)
  const built = dshx('build', '--cwd', project)
  check(`dshx build ${version}`, built.status === 0, built.status === 0 ? '' : built.output)
  const registry = run(process.execPath, [dshxBin, 'registry', 'build', '--out', site], { cwd: project })
  check(`dshx registry build ${version}`, registry.status === 0, registry.status === 0 ? '' : registry.output)
}

let server
const main = async () => {
  console.log(`scratch ${scratch}`)

  // A plugin exactly as `dshx create` writes it. pnpm exits non-zero on ignored build scripts but leaves the project usable.
  dshx('create', PLUGIN, '--cwd', scratch, '--template', 'basic', '--style', 'none', '--yes')
  check('dshx create wrote a plugin', existsSync(join(project, 'dshx.config.ts')))
  writeFileSync(join(project, 'hello-block.ts'), 'export const hello = "from the registry"\n')
  writeFileSync(
    join(project, 'dshx.registry.json'),
    JSON.stringify({
      name: 'roundtrip',
      items: [
        { type: 'dsh:plugin', path: '.', distribution: 'tarball', name: PLUGIN },
        {
          type: 'dsh:source',
          name: 'hello-block',
          version: '1.0.0',
          engines: { dsh: '>=0.2.0-rc.1 <0.3.0-0' },
          files: [{ path: 'hello-block.ts', target: 'src/hello-block.ts' }],
          docs: 'Import it from src/host.ts.',
        },
      ],
    }),
  )

  publish('1.0.0')
  server = spawn(process.execPath, [import.meta.filename, '--serve', site], { stdio: ['ignore', 'pipe', 'inherit'] })
  const port = await new Promise(done => server.stdout.once('data', chunk => done(String(chunk).trim())))
  const base = `http://127.0.0.1:${port}`

  // Discover.
  check('dsh creates the scratch profile', run('dsh', ['plugin', '--profile', PROFILE, 'list']).status === 0)
  const before = readFileSync(join(profileRoot, 'package.json'), 'utf8')
  const alias = dshx('registry', 'add', 'rt', `${base}/registry.json`, '--home', home)
  check('registry add', alias.status === 0, alias.status === 0 ? '' : alias.output)
  check('registry search finds the item', dshx('registry', 'search', 'mini', '--home', home).output.includes(`rt:${PLUGIN}`))

  // Install.
  const added = dshx('add', `rt:${PLUGIN}`, ...inProfile)
  check('dshx add installs the tarball item', added.status === 0, added.status === 0 ? '' : added.output)
  check('the profile holds a file: tarball dependency', profileManifest().dependencies[PLUGIN]?.startsWith('file:') === true)
  check('the bundle entry exists', profileManifest().dsh.profile.bundles.includes(PLUGIN))
  check('version 1.0.0 is installed', installedVersion(PLUGIN) === '1.0.0')
  check('a second add changes nothing', dshx('add', `rt:${PLUGIN}`, ...inProfile).output.includes('up to date'))
  await assertBoots('after add', true)

  // Update.
  publish('1.1.0')
  const updated = dshx('update', `rt:${PLUGIN}`, ...inProfile)
  check('dshx update moves to 1.1.0', updated.status === 0 && installedVersion(PLUGIN) === '1.1.0', updated.status === 0 ? '' : updated.output)
  const kept = readdirSync(join(profileRoot, '.dshx-registry/tarballs'))
  check('only the current tarball is kept', kept.length === 1 && kept[0].includes('1.1.0'), kept.join(', '))
  await assertBoots('after update', true)

  // A tampered release must leave the working install alone.
  publish('1.2.0')
  const tarball = join(site, 'tarballs', `${PLUGIN}-1.2.0.tgz`)
  writeFileSync(tarball, Buffer.concat([readFileSync(tarball), Buffer.from('tampered')]))
  const tampered = dshx('update', PLUGIN, ...inProfile)
  check('a tampered tarball is refused', tampered.status === 1 && tampered.output.includes('does not match the integrity'))
  check('the refused update left 1.1.0 installed', installedVersion(PLUGIN) === '1.1.0')

  // Remove.
  const removed = dshx('remove', `rt:${PLUGIN}`, ...inProfile)
  check('dshx remove uninstalls it', removed.status === 0, removed.status === 0 ? '' : removed.output)
  check('the profile is back to its baseline', selection(profileManifest()) === selection(JSON.parse(before)))
  check(
    'no registry state is left in the profile',
    !existsSync(join(profileRoot, '.dshx-registry/installed.json')) && readdirSync(join(profileRoot, '.dshx-registry/tarballs')).length === 0,
  )
  await assertBoots('after remove', false)

  // Source copy, into the same project.
  const hello = join(project, 'src/hello-block.ts')
  const copied = dshx('add', 'rt:hello-block', '--project', project, '--home', home)
  check('dshx add copies a source item', copied.status === 0 && existsSync(hello), copied.status === 0 ? '' : copied.output)
  check('source item docs are printed', copied.output.includes('Import it from src/host.ts.'))
  check('dshx remove deletes the copied source', dshx('remove', 'hello-block', '--project', project, '--home', home).status === 0 && !existsSync(hello))

  // The npm path, unchanged, against a real package.
  const npmAdded = dshx('add', `${NPM_PLUGIN}@${NPM_FROM}`, ...inProfile)
  check('npm: dshx add name@version', npmAdded.status === 0 && installedVersion(NPM_PLUGIN) === NPM_FROM, npmAdded.status === 0 ? '' : npmAdded.output)
  check('npm: the plan calls it a registry package', npmAdded.output.includes('registry package'))
  check('npm: the dependency is a plain version', !profileManifest().dependencies[NPM_PLUGIN].startsWith('file:'))
  const npmUpdated = dshx('update', NPM_PLUGIN, '--latest', ...inProfile)
  const latest = installedVersion(NPM_PLUGIN)
  check('npm: dshx update --latest moves the version', npmUpdated.status === 0 && latest !== NPM_FROM, `${NPM_FROM} → ${String(latest)}`)
  const npmPinned = dshx('update', `${NPM_PLUGIN}@${NPM_PINNED}`, ...inProfile)
  check('npm: dshx update name@version', npmPinned.status === 0 && installedVersion(NPM_PLUGIN) === NPM_PINNED, npmPinned.status === 0 ? '' : npmPinned.output)
  const npmRemoved = dshx('remove', NPM_PLUGIN, ...inProfile)
  check('npm: dshx remove uninstalls it', npmRemoved.status === 0 && !Object.hasOwn(profileManifest().dependencies ?? {}, NPM_PLUGIN))

  // A registry item can also point at npm, through the same path.
  const npmItem = join(site, 'r', 'npm-example.json')
  writeFileSync(
    npmItem,
    JSON.stringify({ schemaVersion: 1, name: 'npm-example', type: 'dsh:plugin', version: NPM_FROM, package: NPM_PLUGIN, source: { type: 'npm' } }),
  )
  const itemAdded = dshx('add', `${base}/r/npm-example.json`, ...inProfile)
  check(
    'npm item: installs a plain version',
    itemAdded.status === 0 && profileManifest().dependencies[NPM_PLUGIN] === NPM_FROM,
    itemAdded.status === 0 ? '' : itemAdded.output,
  )
  check(
    'npm item: dshx remove uninstalls it',
    dshx('remove', NPM_PLUGIN, ...inProfile).status === 0 && !existsSync(join(profileRoot, '.dshx-registry/installed.json')),
  )

  console.log(`\n${String(results.length)} checks passed`)
}

try {
  await main()
} finally {
  server?.kill()
  if (!process.argv.includes('--keep')) rmSync(scratch, { recursive: true, force: true })
}
