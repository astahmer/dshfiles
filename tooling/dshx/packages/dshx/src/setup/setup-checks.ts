import * as Schema from 'effect/Schema'
import { execa } from 'execa'
import { existsSync, realpathSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decodeJson } from '../json.js'
import { resolveDshExecutable } from '../project/dsh-executable.js'
import { DSHFILES_ROOT } from '../project/local-bundles.js'

export type CheckState = 'ok' | 'warn' | 'fail'

/** One environment fact `dshx setup` found; `fail` blocks Apply, `warn` does not. Never carries a secret value. */
export interface SetupCheck {
  readonly id: string
  readonly label: string
  readonly state: CheckState
  readonly detail: string
  readonly fix: string | null
}

export interface ExistingProfile {
  readonly name: string
  /** A checked-in seed reconciles it before every start (`web`): setup never writes it. */
  readonly seeded: boolean
  /** `dshx setup` chose its plugins (it holds the setup marker). */
  readonly fromSetup: boolean
  readonly running: boolean
}

interface CommandResult {
  readonly found: boolean
  readonly exitCode: number | null
  readonly stdout: string
}

/** Everything the checks read from the machine, so a test can describe a machine instead of using this one. */
export interface SetupProbe {
  readonly root: string
  readonly dshHome: string
  readonly env: NodeJS.ProcessEnv
  readonly nodeVersion: string
  readonly nodeExecPath: string
  readonly run: (command: string, args: readonly string[]) => Promise<CommandResult>
  /** Running Host pids for one profile of `dshHome`, from scripts/running-hosts.mjs. */
  readonly runningHosts: (profile: string) => Promise<readonly number[]>
}

const MARKER_FILE = 'dshfiles-setup.json'

const runCommand = async (command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<CommandResult> => {
  const result = await execa(command, [...args], { env, reject: false, timeout: 5_000, stdin: 'ignore' })
  return { found: result.exitCode !== undefined, exitCode: result.exitCode ?? null, stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '' }
}

/** scripts/running-hosts.mjs's parser; its result is decoded again, since a plain .mjs has no types. */
type MatchingHostPids = (
  psText: string,
  options: { readonly home: string; readonly profile: string; readonly coreEntry: string; readonly uid: number },
) => readonly number[]

const runningHostsModuleSchema = Schema.Struct({
  matchingHostPids: Schema.declare((value: unknown): value is MatchingHostPids => typeof value === 'function'),
})
const pidsSchema = Schema.Array(Schema.Number)

/** One `ps` read shared by every profile check; running-hosts.mjs owns how a Host process is recognised. */
const runningHostsReader = async (input: { readonly root: string; readonly dshHome: string; readonly env: NodeJS.ProcessEnv }) => {
  const module = Schema.decodeUnknownSync(runningHostsModuleSchema)(await import(pathToFileURL(join(input.root, 'scripts/running-hosts.mjs')).href))
  const ps = await execa('ps', ['axeww', '-o', 'pid=,uid=,command='], { env: input.env, reject: false, maxBuffer: 64 * 1024 * 1024 })
  if (ps.exitCode !== 0) throw new Error('Could not read the process table to find running DSH Hosts.')
  const coreEntry = await resolveDshExecutable(undefined, input.env, input.root)
  return async (profile: string): Promise<readonly number[]> =>
    Schema.decodeUnknownSync(pidsSchema)(module.matchingHostPids(ps.stdout, { home: input.dshHome, profile, coreEntry, uid: process.getuid?.() ?? 0 }))
}

const probeOf = async (input: { readonly dshHome: string; readonly env?: NodeJS.ProcessEnv }): Promise<SetupProbe> => {
  const env = input.env ?? process.env
  return {
    root: DSHFILES_ROOT,
    dshHome: input.dshHome,
    env,
    nodeVersion: process.version,
    nodeExecPath: process.execPath,
    run: (command, args) => runCommand(command, args, env),
    runningHosts: await runningHostsReader({ root: DSHFILES_ROOT, dshHome: input.dshHome, env }),
  }
}

const firstLine = (text: string): string => text.split('\n')[0]?.trim() ?? ''

const nodeChecks = async (probe: SetupProbe, pinned: string): Promise<readonly SetupCheck[]> => {
  const resolved = existsSync(probe.nodeExecPath) ? realpathSync(probe.nodeExecPath) : probe.nodeExecPath
  const fromNix = resolved.startsWith('/nix/store/') || probe.nodeExecPath.includes('/.nix-profile/')
  const fnm = await probe.run('fnm', ['--version'])
  return [
    probe.nodeVersion === `v${pinned}`
      ? { id: 'node-version', label: 'Node', state: 'ok', detail: probe.nodeVersion, fix: null }
      : {
          id: 'node-version',
          label: 'Node',
          state: 'fail',
          detail: `${probe.nodeVersion}, the checkout pins ${pinned}`,
          fix: `fnm install ${pinned} && fnm use ${pinned}`,
        },
    fromNix
      ? {
          id: 'node-origin',
          label: 'Node build',
          state: 'fail',
          detail: 'A Nix build: dsh fails at boot with it',
          fix: 'Put fnm first on PATH (nix develop or direnv allow does it), then run setup again',
        }
      : { id: 'node-origin', label: 'Node build', state: 'ok', detail: 'Official build', fix: null },
    fnm.exitCode === 0
      ? { id: 'fnm', label: 'fnm', state: 'ok', detail: firstLine(fnm.stdout), fix: null }
      : { id: 'fnm', label: 'fnm', state: 'warn', detail: 'Not found', fix: 'Install fnm (https://github.com/Schniz/fnm) to switch to the pinned Node' },
  ]
}

const toolCheck = async (
  probe: SetupProbe,
  tool: { readonly id: string; readonly label: string; readonly missing: CheckState; readonly fix: string },
): Promise<SetupCheck> => {
  const result = await probe.run(tool.id, ['--version'])
  return result.exitCode === 0
    ? { id: tool.id, label: tool.label, state: 'ok', detail: firstLine(result.stdout), fix: null }
    : { id: tool.id, label: tool.label, state: tool.missing, detail: 'Not found', fix: tool.fix }
}

const checkoutCheck = (probe: SetupProbe): SetupCheck => {
  const missing = ['scripts/profile-sync.ts', 'plugins/@dshfiles/onboarding/src/packs.ts', 'node_modules'].filter(path => !existsSync(join(probe.root, path)))
  return missing.length === 0
    ? { id: 'checkout', label: 'Checkout', state: 'ok', detail: probe.root, fix: null }
    : { id: 'checkout', label: 'Checkout', state: 'fail', detail: `Missing ${missing.join(', ')}`, fix: `cd ${probe.root} && pnpm install --frozen-lockfile` }
}

const dshCheck = async (probe: SetupProbe, pinned: string | undefined): Promise<SetupCheck> => {
  const executable = await resolveDshExecutable(undefined, probe.env, probe.root)
  const result = await probe.run(executable, ['--version'])
  if (result.exitCode !== 0)
    return { id: 'dsh', label: 'dsh', state: 'fail', detail: 'Not installed in this checkout', fix: `cd ${probe.root} && pnpm install --frozen-lockfile` }
  const version = firstLine(result.stdout)
  if (pinned !== undefined && !version.includes(pinned))
    return {
      id: 'dsh',
      label: 'dsh',
      state: 'warn',
      detail: `${version}, the checkout pins ${pinned}`,
      fix: `cd ${probe.root} && pnpm install --frozen-lockfile`,
    }
  return { id: 'dsh', label: 'dsh', state: 'ok', detail: version, fix: null }
}

const githubCheck = async (probe: SetupProbe): Promise<SetupCheck> => {
  const installed = await probe.run('gh', ['--version'])
  if (installed.exitCode !== 0)
    return { id: 'gh', label: 'GitHub CLI', state: 'warn', detail: 'Not found', fix: 'Install the GitHub CLI (https://cli.github.com) for the GitHub pack' }
  // Only the exit code is read: gh prints the account name, which setup never shows.
  const auth = await probe.run('gh', ['auth', 'status', '--hostname', 'github.com'])
  return auth.exitCode === 0
    ? { id: 'gh', label: 'GitHub CLI', state: 'ok', detail: 'Signed in', fix: null }
    : { id: 'gh', label: 'GitHub CLI', state: 'warn', detail: 'Not signed in', fix: 'gh auth login' }
}

const manifestSchema = Schema.Struct({ devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) })

const pinnedDsh = async (root: string): Promise<string | undefined> => {
  const file = join(root, 'tooling/dshx/package.json')
  if (!existsSync(file)) return undefined
  return decodeJson(manifestSchema, await readFile(file, 'utf8')).devDependencies?.['@deepseek-ai/dsh']
}

/** Profiles under the DSH home, which are seeded, chosen by setup or served by a running Host. */
const existingProfiles = async (probe: SetupProbe): Promise<readonly ExistingProfile[]> => {
  const directory = join(probe.dshHome, 'profiles')
  if (!existsSync(directory)) return []
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries.filter(entry => entry.isDirectory() && existsSync(join(directory, entry.name, 'package.json'))).map(entry => entry.name)
  return Promise.all(
    names.sort().map(async name => ({
      name,
      seeded: existsSync(join(probe.root, 'profiles', name)),
      fromSetup: existsSync(join(directory, name, MARKER_FILE)),
      running: (await probe.runningHosts(name)).length > 0,
    })),
  )
}

const homeCheck = (probe: SetupProbe, profiles: readonly ExistingProfile[]): SetupCheck => {
  if (!existsSync(probe.dshHome)) return { id: 'dsh-home', label: 'DSH home', state: 'ok', detail: `${probe.dshHome} (new)`, fix: null }
  const running = profiles.filter(profile => profile.running).length
  const detail = `${probe.dshHome}, ${String(profiles.length)} profile${profiles.length === 1 ? '' : 's'}${running > 0 ? `, ${String(running)} running` : ''}`
  return { id: 'dsh-home', label: 'DSH home', state: 'ok', detail, fix: null }
}

/** Read the machine once: Node, tools, the checkout, dsh, the DSH home and its profiles. Presence only, never a secret. */
const inspect = async (probe: SetupProbe): Promise<{ readonly checks: readonly SetupCheck[]; readonly profiles: readonly ExistingProfile[] }> => {
  const pinnedNode = existsSync(join(probe.root, '.node-version')) ? (await readFile(join(probe.root, '.node-version'), 'utf8')).trim() : ''
  const profiles = await existingProfiles(probe)
  const vcs = await Promise.all([
    toolCheck(probe, { id: 'jj', label: 'Jujutsu', missing: 'warn', fix: 'Install Jujutsu (https://jj-vcs.github.io) for the versioning pack' }),
    toolCheck(probe, { id: 'git', label: 'Git', missing: 'warn', fix: 'Install git' }),
  ])
  const checks: SetupCheck[] = [
    ...(await nodeChecks(probe, pinnedNode)),
    await toolCheck(probe, { id: 'pnpm', label: 'pnpm', missing: 'fail', fix: 'corepack enable' }),
    checkoutCheck(probe),
    await dshCheck(probe, await pinnedDsh(probe.root)),
    homeCheck(probe, profiles),
    await githubCheck(probe),
    ...vcs,
  ]
  return { checks, profiles }
}

/** The environment checks behind `dshx setup`'s first screen. */
export class SetupChecks {
  static readonly markerFile = MARKER_FILE
  static readonly probe = probeOf
  static readonly inspect = inspect
  static readonly blocking = (checks: readonly SetupCheck[]): boolean => checks.some(check => check.state === 'fail')
}
