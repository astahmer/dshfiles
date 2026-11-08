#!/usr/bin/env node
// Adopt deepseek-ai/dsh-superagent-prototype unchanged: fetch it at the commit pinned in superagent.pin.json, build it
// with its own lockfile, and install it into a dedicated stock DSH profile (default `superagent`). It never touches the
// `web` profile, a profile seeded from this repository, or a running DSH: start, stop and restart go through the
// upstream service script, which refuses duplicates and never force-kills. See docs/superagent.md.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pinPath = join(repositoryRoot, 'scripts/superagent.pin.json')
const profileName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const serviceCommands = new Set(['start', 'stop', 'restart', 'status'])
const commands = new Set(['plan', 'fetch', 'build', 'install', 'setup', ...serviceCommands])
const patchMarker = '# dsh-superagent rows added by dshfiles scripts/superagent.mjs; see docs/superagent.md.'

const usage = `Usage: node scripts/superagent.mjs <command> [options]

Commands:
  plan      Print what fetch, build and install would run (default)
  fetch     Clone or update the upstream checkout at the pinned commit
  build     pnpm install --frozen-lockfile && pnpm build in that checkout
  install   Create the dedicated profile if missing, link the bundle, add its rows
  setup     fetch + build + install
  start | stop | restart | status
            Run the upstream service script (scripts/dsh-superagent) for the profile

Options:
  --profile <name>    Dedicated DSH profile (default: superagent, env DSH_SUPERAGENT_PROFILE)
  --source <dir>      Upstream checkout (default: $XDG_DATA_HOME/dshfiles/dsh-superagent, env DSH_SUPERAGENT_SOURCE)
  --state-dir <dir>   Absolute stateDir for the dsh-superagent row (default: $DSH_HOME/state/<profile>)
  --port <n>          Panel port for the profile's webserver row (default: 3082)
  --dsh <command>     DSH launcher (default: dsh, env DSH_BIN)
  --dry-run           Print the commands and file writes without running them`

/** Reads and validates the pin; a malformed pin fails closed instead of fetching an arbitrary revision. */
const loadPin = (path = pinPath) => {
  const pin = JSON.parse(readFileSync(path, 'utf8'))
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(pin.repository ?? ''))
    throw new Error(`${path}: repository must be a https://github.com/<owner>/<name> URL`)
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? '')) throw new Error(`${path}: commit must be a full 40-character commit id`)
  if (pin.package !== 'dsh-superagent') throw new Error(`${path}: package must be dsh-superagent`)
  return pin
}

const resolveOptions = (argv, env = process.env) => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      source: { type: 'string' },
      'state-dir': { type: 'string' },
      port: { type: 'string' },
      dsh: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = positionals[0] ?? 'plan'
  if (values.help) return { command: 'help' }
  if (!commands.has(command) || positionals.length > 1) throw new Error(`Unknown command ${positionals.join(' ')}.\n\n${usage}`)
  const home = env.HOME || homedir()
  const dshHome = env.DSH_HOME?.trim() || join(home, '.dsh')
  const profile = values.profile ?? env.DSH_SUPERAGENT_PROFILE ?? 'superagent'
  if (!profileName.test(profile)) throw new Error(`Profile name ${JSON.stringify(profile)} must start with a letter or digit, then letters, digits, _ or -.`)
  const source = resolve(values.source ?? env.DSH_SUPERAGENT_SOURCE ?? join(env.XDG_DATA_HOME || join(home, '.local/share'), 'dshfiles/dsh-superagent'))
  const stateDir = values['state-dir'] ?? join(dshHome, 'state', profile)
  if (!isAbsolute(stateDir)) throw new Error(`--state-dir must be an absolute path; got ${stateDir}.`)
  const port = Number(values.port ?? 3082)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`--port must be an integer from 1 to 65535; got ${values.port}.`)
  return { command, profile, source, stateDir, port, dshHome, dsh: values.dsh ?? env.DSH_BIN ?? 'dsh', dryRun: values['dry-run'] }
}

/**
 * dsh-superagent changes process-wide PATH and git configuration and restarts on its own schedule, so it gets its own
 * stock profile. Refuse `web` and any profile this repository seeds: profile-sync would fight over its rows.
 */
const assertDedicatedProfile = (profile, root = repositoryRoot) => {
  if (profile === 'web' || existsSync(join(root, 'profiles', profile, 'package.json'))) {
    throw new Error(
      `Profile ${profile} is reconciled from profiles/${profile}/ in this repository; dsh-superagent needs a dedicated profile.\n` +
        'Run again with --profile superagent (or another name that has no seed under profiles/).',
    )
  }
}

const renderPatch = ({ stateDir, port }) =>
  [
    patchMarker,
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    `    port: ${port}`,
    '- id: dsh-superagent',
    '  config:',
    `    stateDir: ${JSON.stringify(stateDir)}`,
    '# Feishu is optional: set disabled: false, then configure the bot lark-cli on the Feishu Source.',
    '# - id: dsh-superagent-feishu',
    '#   disabled: false',
    '',
  ].join('\n')

/** Adds the rows once. An existing dsh-superagent row is the operator's machine configuration and stays as it is. */
const mergePatch = (input, options) => {
  // The DSH template writes an empty flow list (`[]`) under its comments; block rows cannot follow it.
  const meaningful = input?.split('\n').filter(line => line.trim() !== '' && !line.trim().startsWith('#')) ?? []
  const existing = meaningful.length === 1 && meaningful[0]?.trim() === '[]' ? input?.replace(/^\s*\[\]\s*$/m, '') : input
  if (existing !== undefined && /^\s*-\s*id:\s*['"]?dsh-superagent['"]?\s*$/m.test(existing)) return { text: existing, changed: false }
  if (existing !== undefined && /^\s*-\s*id:\s*['"]?webserver['"]?\s*$/m.test(existing)) {
    const rows = renderPatch(options).split('\n')
    const withoutWebserver = [rows[0], ...rows.slice(5)].join('\n')
    return { text: `${existing.replace(/\n*$/, '\n')}${withoutWebserver}`, changed: true, keptWebserver: true }
  }
  const prefix = existing === undefined || existing.trim() === '' ? '' : existing.replace(/\n*$/, '\n')
  return { text: `${prefix}${renderPatch(options)}`, changed: true }
}

const step = (label, argv, cwd) => ({ label, argv, cwd })

const fetchSteps = (pin, source, exists) => [
  ...(exists ? [] : [step('clone the upstream repository', ['git', 'clone', '--no-checkout', pin.repository, source])]),
  step('fetch the pinned commit', ['git', '-C', source, 'fetch', '--no-tags', 'origin', pin.commit]),
  step('check out the pinned commit (detached)', ['git', '-C', source, 'checkout', '--detach', pin.commit]),
]

const buildSteps = source => [
  step('install its dependencies from its own lockfile', ['pnpm', 'install', '--frozen-lockfile'], source),
  step('build lib/', ['pnpm', 'build'], source),
]

const installSteps = ({ dsh, profile, source }, profileExists, linked) => [
  ...(profileExists ? [] : [step(`create profile ${profile} from the DSH Web template`, [dsh, profile, '--from-default-profile', 'web', '--dump-config'])]),
  ...(linked ? [] : [step('link the bundle into the profile', [dsh, 'plugin', '--profile', profile, 'add', `link:${source}`])]),
]

const run = ({ label, argv, cwd }, dryRun, { quiet = false } = {}) => {
  console.log(`superagent: ${label}\n  $ ${argv.join(' ')}${cwd ? `   (in ${cwd})` : ''}`)
  if (dryRun) return
  const result = spawnSync(argv[0], argv.slice(1), { cwd, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' })
  if (result.error) throw new Error(`${argv[0]} could not run: ${result.error.message}. Install it or pass its path (--dsh for DSH).`)
  if (result.status !== 0) throw new Error(`${argv.join(' ')} exited with code ${result.status}; fix the cause above and run the same command again.`)
}

const git = (source, ...args) => spawnSync('git', ['-C', source, ...args], { encoding: 'utf8' })

/** The checkout must be the pinned upstream, clean, before anything builds or links it. */
const checkSource = (pin, source) => {
  const origin = git(source, 'remote', 'get-url', 'origin')
    .stdout.trim()
    .replace(/\.git$/, '')
  if (origin !== pin.repository)
    throw new Error(`${source} has origin ${origin || '(none)'}, not ${pin.repository}. Pass --source <empty dir> or fix its origin.`)
  const dirty = git(source, 'status', '--porcelain', '--untracked-files=no').stdout.trim()
  if (dirty !== '') throw new Error(`${source} has local edits:\n${dirty}\nKeep them elsewhere (git -C ${source} stash) before syncing to the pin.`)
  return git(source, 'rev-parse', 'HEAD').stdout.trim()
}

const profilePaths = ({ dshHome, profile }) => {
  const directory = join(dshHome, 'profiles', profile)
  return { directory, manifest: join(directory, 'package.json'), patch: join(directory, 'cordis.patch.yml') }
}

const isLinked = manifestPath => {
  if (!existsSync(manifestPath)) return false
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return manifest.dependencies?.['dsh-superagent'] !== undefined && (manifest.dsh?.profile?.bundles ?? []).includes('dsh-superagent')
}

const doFetch = (pin, options) => {
  const exists = existsSync(join(options.source, '.git'))
  if (exists && !options.dryRun) checkSource(pin, options.source)
  if (!exists && !options.dryRun) mkdirSync(dirname(options.source), { recursive: true })
  for (const item of fetchSteps(pin, options.source, exists)) run(item, options.dryRun)
}

const doBuild = (pin, options) => {
  if (!options.dryRun) {
    const head = checkSource(pin, options.source)
    if (head !== pin.commit) throw new Error(`${options.source} is at ${head}, not the pinned ${pin.commit}. Run: node scripts/superagent.mjs fetch`)
  }
  for (const item of buildSteps(options.source)) run(item, options.dryRun)
}

const doInstall = (pin, options) => {
  assertDedicatedProfile(options.profile)
  if (!options.dryRun && !existsSync(join(options.source, 'lib/index.js'))) {
    throw new Error(`${options.source}/lib/index.js is missing. Run: node scripts/superagent.mjs build`)
  }
  const paths = profilePaths(options)
  const profileExists = existsSync(paths.manifest)
  for (const item of installSteps(options, profileExists, isLinked(paths.manifest))) run(item, options.dryRun, { quiet: item.argv.includes('--dump-config') })
  const existing = existsSync(paths.patch) ? readFileSync(paths.patch, 'utf8') : undefined
  const merged = mergePatch(existing, options)
  if (!merged.changed) {
    console.log(`superagent: ${paths.patch} already has a dsh-superagent row; left unchanged.`)
  } else {
    console.log(
      `superagent: add the dsh-superagent rows to ${paths.patch}${merged.keptWebserver ? ' (its webserver row is kept; set port there if needed)' : ''}`,
    )
    if (options.dryRun) console.log(renderPatch(options).replace(/^/gm, '  | '))
    else {
      mkdirSync(paths.directory, { recursive: true })
      writeFileSync(paths.patch, merged.text)
    }
  }
  if (!options.dryRun) mkdirSync(options.stateDir, { recursive: true, mode: 0o700 })
  console.log(
    [
      '',
      `Next: node scripts/superagent.mjs start --profile ${options.profile}`,
      `Then ask an agent to follow SETUP.md from step 2 in ${options.source} (install is done), or open the panel on port ${options.port} and choose Superagent.`,
    ].join('\n'),
  )
}

const doService = (pin, options) => {
  const script = join(options.source, 'scripts/dsh-superagent')
  if (!existsSync(script)) throw new Error(`${script} is missing. Run: node scripts/superagent.mjs fetch`)
  const result = spawnSync('python3', [script, '--profile', options.profile, options.command], { stdio: 'inherit', cwd: options.source })
  if (result.error) throw new Error(`python3 could not run: ${result.error.message}. Install Python 3.8 or later.`)
  return result.status ?? 1
}

const main = (argv = process.argv.slice(2), env = process.env) => {
  const options = resolveOptions(argv, env)
  if (options.command === 'help') {
    console.log(usage)
    return 0
  }
  const pin = loadPin()
  if (serviceCommands.has(options.command)) return doService(pin, options)
  console.log(
    `superagent: ${pin.repository} @ ${pin.commit.slice(0, 12)} (v${pin.version}, ${pin.license}); profile ${options.profile}; source ${options.source}`,
  )
  const dryRun = options.dryRun || options.command === 'plan'
  const effective = { ...options, dryRun }
  if (['plan', 'fetch', 'setup'].includes(options.command)) doFetch(pin, effective)
  if (['plan', 'build', 'setup'].includes(options.command)) doBuild(pin, effective)
  if (['plan', 'install', 'setup'].includes(options.command)) doInstall(pin, effective)
  return 0
}

/** The installer's steps and guards, grouped for the tests; `main` is the CLI. */
export class Superagent {
  static loadPin = loadPin
  static resolveOptions = resolveOptions
  static assertDedicatedProfile = assertDedicatedProfile
  static renderPatch = renderPatch
  static mergePatch = mergePatch
  static fetchSteps = fetchSteps
  static buildSteps = buildSteps
  static installSteps = installSteps
  static checkSource = checkSource
  static main = main
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`superagent: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
