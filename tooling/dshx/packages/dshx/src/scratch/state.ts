import { spawn, spawnSync } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { z } from 'zod'
import { REACH_SEEDS } from '../project/features.js'

/** The live DSH the user works in; a scratch instance never takes its port or its home. */
export const LIVE_DSH_PORT = 3080
export const LIVE_DSH_HOME = resolve(process.env.DSH_LIVE_HOME ?? join(homedir(), '.dsh'))

export class ScratchError extends Error {
  readonly code: string
  readonly hint: string
  constructor(code: string, message: string, hint: string) {
    super(message)
    this.name = 'ScratchError'
    this.code = code
    this.hint = hint
  }
}

const ownedProcessSchema = z.object({ pid: z.number().int().positive(), signature: z.array(z.string().min(1)).min(1) }).strict()

export const ScratchStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string(),
    createdAt: z.string(),
    stateDir: z.string(),
    home: z.string(),
    profile: z.string(),
    port: z.number().int(),
    origin: z.string(),
    /** Tokenized launch URL. A secret: only this file (mode 600) holds it; never print it. */
    launchUrl: z.string(),
    bundles: z.array(z.string()),
    expectedClientEntries: z.array(z.string()),
    project: z.object({ path: z.string(), workspaceId: z.string(), ownedByScratch: z.boolean() }).strict(),
    host: ownedProcessSchema,
    browser: ownedProcessSchema.extend({ cdpPort: z.number().int() }).strict(),
    hostLog: z.string(),
    browserLog: z.string(),
    browserEvents: z.string(),
    evidenceDir: z.string(),
    /** Directory holding the fake `secret` CLI and its store, first on the Host's PATH (`up --fake-secret-cli`). */
    fakeSecretCli: z.string().optional(),
    /** Seeds `dshx dev open` already applied to this instance, with the checkout file one changed for `down` to restore. */
    seeds: z.array(z.object({ seed: z.enum(REACH_SEEDS), changedFile: z.string().optional() }).strict()).optional(),
    /** The loopback model provider the `tool-call-thread` seed started; `down` stops it. */
    fakeProvider: ownedProcessSchema.optional(),
  })
  .strict()

export type ScratchState = z.infer<typeof ScratchStateSchema>

export const scratchNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'use 1-32 lowercase letters, digits or hyphens')

export const resolveStateDir = (options: { readonly name: string; readonly stateDir?: string }): string =>
  resolve(options.stateDir ?? join(process.env.DSHX_DEV_STATE_ROOT ?? join(tmpdir(), 'dshx-dev'), options.name))

const stateFile = (stateDir: string): string => join(stateDir, 'state.json')

export const readScratchState = async (stateDir: string, name: string): Promise<ScratchState> => {
  const source = await readFile(stateFile(stateDir), 'utf8').catch(() => undefined)
  if (source === undefined) {
    throw new ScratchError(
      'not-up',
      `No scratch DSH named "${name}" is recorded in ${stateDir}.`,
      `Run "dshx dev up${name === 'default' ? '' : ` --name ${name}`}" first.`,
    )
  }
  const parsed = ScratchStateSchema.safeParse(JSON.parse(source))
  if (!parsed.success) {
    throw new ScratchError(
      'invalid-state',
      `The scratch state in ${stateFile(stateDir)} is unreadable: ${parsed.error.issues[0]?.message ?? 'invalid shape'}.`,
      'Run "dshx dev down --dry-run" to see what it would stop, then "dshx dev down".',
    )
  }
  return parsed.data
}

export const writeScratchState = async (state: ScratchState): Promise<void> => {
  await mkdir(state.stateDir, { recursive: true, mode: 0o700 })
  await writeFile(stateFile(state.stateDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export const removeScratchStateFile = (stateDir: string): Promise<void> => rm(stateFile(stateDir), { force: true })

/** The state minus the launch token, safe to print. */
export const publicState = (state: ScratchState) => ({
  name: state.name,
  origin: state.origin,
  port: state.port,
  home: state.home,
  profile: state.profile,
  stateDir: state.stateDir,
  project: state.project.path,
  bundles: state.bundles,
  hostPid: state.host.pid,
  browserPid: state.browser.pid,
  hostLog: state.hostLog,
  evidenceDir: state.evidenceDir,
})

export const isWithin = (root: string, target: string): boolean => {
  const normalizedRoot = resolve(root)
  const normalizedTarget = resolve(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

/** Running, and still the process we started: its command line carries every signature fragment. */
export const ownedProcessStatus = (owned: { readonly pid: number; readonly signature: readonly string[] }): 'running' | 'gone' | 'foreign' => {
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(owned.pid)], { encoding: 'utf8' })
  const command = result.stdout.trim()
  if (result.status !== 0 || command === '') return 'gone'
  return owned.signature.every(fragment => command.includes(fragment)) ? 'running' : 'foreign'
}

export const redactUrls = (text: string): string =>
  text.replace(/https?:\/\/(127\.0\.0\.1|localhost):\d+\/[^\s"']*/g, match => `${new URL(match).origin}/[redacted]`)

/** Start a process in its own group, logging to `log`, so `down` can stop it and everything it spawned. */
export const spawnDetached = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly log: string },
): number => {
  const output = openSync(options.log, 'a', 0o600)
  try {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ['ignore', output, output] })
    child.unref()
    if (child.pid === undefined)
      throw new ScratchError('spawn-failed', `${command} did not start.`, `Check that ${command} is on PATH (run dshx through fnm exec --using=22.23.3).`)
    return child.pid
  } finally {
    closeSync(output)
  }
}
