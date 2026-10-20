import { posix } from 'node:path'
import { shellQuote } from './connectors/ssh.js'
import { RemoteExec } from './remote-exec.js'
import { RemoteDoctor, type RemoteFacts } from './remote-doctor.js'
import { RemoteRuntime } from './remote-runtime.js'

const provisionStepIds = ['node', 'checkout', 'install', 'build', 'cli', 'profile', 'runtime'] as const

export type ProvisionStepId = (typeof provisionStepIds)[number]
export type ProvisionStepState = 'done' | 'pending' | 'blocked'

export interface ProvisionOptions {
  readonly remoteHome: string
  readonly checkoutPath: string
  readonly profile: string
  readonly dshVersion: string
  readonly nodeVersion: string
  readonly repository: string
  readonly revision?: string | undefined
}

export interface ProvisionPlanStep {
  readonly id: ProvisionStepId
  readonly title: string
  readonly state: ProvisionStepState
  readonly reason: string
  readonly commands: string[]
}

const titles: Record<ProvisionStepId, string> = {
  node: 'Official Node build',
  checkout: 'dshfiles checkout',
  install: 'Workspace dependencies',
  build: 'Workspace build',
  cli: 'DSH CLI',
  profile: 'web profile',
  runtime: 'headless runtime',
}

const directoryOf = (path: string | undefined): string | undefined => (path === undefined ? undefined : posix.dirname(path))

const shellPath = ({ facts, nodePath }: { readonly facts: RemoteFacts; readonly nodePath: string | undefined }): string => {
  const directories = [
    directoryOf(nodePath),
    directoryOf(facts.dsh.path),
    directoryOf(facts.pnpm.path),
    facts.home === undefined ? undefined : `${facts.home}/.local/share/pnpm/bin`,
  ].filter((directory): directory is string => directory !== undefined && directory !== '.')
  return [...directories.map(directory => shellQuote(directory)), '"$PATH"'].join(':')
}

const pnpmHome = ({ facts }: { readonly facts: RemoteFacts }): string => `${facts.home ?? '$HOME'}/.local/share/pnpm`

/** Commands run with the official Node first on PATH and the pnpm global bin directory reachable. */
const withEnvironment = ({
  facts,
  nodePath,
  command,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly command: string
}): string => `env PATH=${shellPath({ facts, nodePath })} PNPM_HOME=${shellQuote(pnpmHome({ facts }))} ${command}`

const inCheckout = ({
  facts,
  nodePath,
  checkoutPath,
  command,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly checkoutPath: string
  readonly command: string
}): string => `cd ${shellQuote(checkoutPath)} && ${withEnvironment({ facts, nodePath, command })}`

const stepOf = ({
  id,
  state,
  reason,
  commands,
}: {
  readonly id: ProvisionStepId
  readonly state: ProvisionStepState
  readonly reason: string
  readonly commands?: string[]
}): ProvisionPlanStep => ({ id, title: titles[id], state, reason, commands: commands ?? [] })

const planNode = ({ facts, options }: { readonly facts: RemoteFacts; readonly options: ProvisionOptions }): ProvisionPlanStep => {
  const official = RemoteDoctor.officialNodePath({ nodes: facts.fnm.nodes, minimum: options.nodeVersion })
  if (official !== undefined) return stepOf({ id: 'node', state: 'done', reason: `official Node build available at ${official}` })
  if (facts.fnm.path === undefined)
    return stepOf({ id: 'node', state: 'blocked', reason: 'no fnm on the remote machine; install it through that machine setup' })
  return stepOf({
    id: 'node',
    state: 'pending',
    reason: `no official Node ${options.nodeVersion} build found`,
    commands: [`${shellQuote(facts.fnm.path)} install ${shellQuote(options.nodeVersion)}`],
  })
}

const planCheckout = ({ facts, options }: { readonly facts: RemoteFacts; readonly options: ProvisionOptions }): ProvisionPlanStep => {
  if (facts.jj.path === undefined) return stepOf({ id: 'checkout', state: 'blocked', reason: 'no jj on the remote machine' })
  const clone = `${shellQuote(facts.jj.path)} git clone ${shellQuote(options.repository)} ${shellQuote(options.checkoutPath)}`
  if (!facts.checkout.exists) return stepOf({ id: 'checkout', state: 'pending', reason: `no checkout at ${options.checkoutPath}`, commands: [clone] })
  if (options.revision === undefined)
    return stepOf({ id: 'checkout', state: 'done', reason: `checkout at ${facts.checkout.commitId ?? 'unknown'}`, commands: [] })
  if (facts.checkout.commitId === options.revision || facts.checkout.mainOrigin === options.revision) {
    return stepOf({ id: 'checkout', state: 'done', reason: `checkout already at ${options.revision}` })
  }
  return stepOf({
    id: 'checkout',
    state: 'pending',
    reason: `checkout at ${facts.checkout.commitId ?? 'unknown'} wants ${options.revision}`,
    commands: [`${shellQuote(facts.jj.path)} -R ${shellQuote(options.checkoutPath)} git fetch`],
  })
}

const blockingReason = ({ facts, nodePath }: { readonly facts: RemoteFacts; readonly nodePath: string | undefined }): string | undefined => {
  if (!facts.checkout.exists) return 'the checkout is missing'
  if (nodePath === undefined) return 'no official Node build to run tools with'
  if (facts.pnpm.path === undefined) return 'no pnpm on the remote machine'
  return undefined
}

const planInstall = ({
  facts,
  nodePath,
  options,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly options: ProvisionOptions
}): ProvisionPlanStep => {
  if (facts.checkout.installed) return stepOf({ id: 'install', state: 'done', reason: 'node_modules present' })
  const blocked = blockingReason({ facts, nodePath })
  if (blocked !== undefined) return stepOf({ id: 'install', state: 'blocked', reason: blocked })
  return stepOf({
    id: 'install',
    state: 'pending',
    reason: 'node_modules missing',
    commands: [inCheckout({ facts, nodePath, checkoutPath: options.checkoutPath, command: 'pnpm install --frozen-lockfile' })],
  })
}

const planBuild = ({
  facts,
  nodePath,
  options,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly options: ProvisionOptions
}): ProvisionPlanStep => {
  if (facts.checkout.built) return stepOf({ id: 'build', state: 'done', reason: 'built bundles present' })
  const blocked = blockingReason({ facts, nodePath })
  if (blocked !== undefined) return stepOf({ id: 'build', state: 'blocked', reason: blocked })
  return stepOf({
    id: 'build',
    state: 'pending',
    reason: 'built bundles missing',
    commands: [inCheckout({ facts, nodePath, checkoutPath: options.checkoutPath, command: 'pnpm run build' })],
  })
}

const planCli = ({
  facts,
  nodePath,
  options,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly options: ProvisionOptions
}): ProvisionPlanStep => {
  if (facts.dsh.version === options.dshVersion) return stepOf({ id: 'cli', state: 'done', reason: `dsh ${options.dshVersion} installed` })
  if (nodePath === undefined) return stepOf({ id: 'cli', state: 'blocked', reason: 'no official Node build to run pnpm with' })
  if (facts.pnpm.path === undefined) return stepOf({ id: 'cli', state: 'blocked', reason: 'no pnpm on the remote machine' })
  return stepOf({
    id: 'cli',
    state: 'pending',
    reason: `installed dsh is ${facts.dsh.version ?? 'absent'}`,
    commands: [withEnvironment({ facts, nodePath, command: `pnpm add -g ${shellQuote(`@deepseek-ai/dsh@${options.dshVersion}`)}` })],
  })
}

const planProfile = ({
  facts,
  nodePath,
  options,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly options: ProvisionOptions
}): ProvisionPlanStep => {
  const expectedCore = facts.dsh.version ?? options.dshVersion
  const fresh = facts.profile.exists && facts.profile.pluginLinks > 0 && (facts.profile.coreVersion === undefined || facts.profile.coreVersion === expectedCore)
  if (fresh) return stepOf({ id: 'profile', state: 'done', reason: `${facts.profile.pluginLinks} plugin link(s) in the ${options.profile} profile` })
  const blocked = blockingReason({ facts, nodePath })
  if (blocked !== undefined) return stepOf({ id: 'profile', state: 'blocked', reason: blocked })
  return stepOf({
    id: 'profile',
    state: 'pending',
    reason: facts.profile.exists ? 'the profile pins a different core version or has no links' : 'no profile',
    commands: [
      inCheckout({ facts, nodePath, checkoutPath: options.checkoutPath, command: `node scripts/profile-sync.ts --profile ${shellQuote(options.profile)}` }),
    ],
  })
}

const planRuntime = ({
  facts,
  nodePath,
  options,
}: {
  readonly facts: RemoteFacts
  readonly nodePath: string | undefined
  readonly options: ProvisionOptions
}): ProvisionPlanStep => {
  if (facts.launch.files.length > 0) return stepOf({ id: 'runtime', state: 'done', reason: `launch file present, port ${facts.launch.port ?? 'unknown'}` })
  if (nodePath === undefined) return stepOf({ id: 'runtime', state: 'blocked', reason: 'no official Node build to start DSH with' })
  if (facts.dsh.path === undefined) return stepOf({ id: 'runtime', state: 'blocked', reason: 'no dsh CLI on the remote machine' })
  return stepOf({
    id: 'runtime',
    state: 'pending',
    reason: 'no launch file: the runtime is not running',
    commands: [
      RemoteRuntime.startCommand({
        remoteHome: options.remoteHome,
        checkoutPath: options.checkoutPath,
        profile: options.profile,
        dshPath: facts.dsh.path,
        platform: facts.uname.startsWith('Darwin') ? 'Darwin' : undefined,
        pathDirectories: [
          directoryOf(nodePath),
          directoryOf(facts.dsh.path),
          directoryOf(facts.pnpm.path),
          facts.home === undefined ? undefined : `${facts.home}/.local/share/pnpm/bin`,
        ].filter((directory): directory is string => directory !== undefined && directory !== '.'),
      }),
      RemoteRuntime.waitForLaunchCommand({ remoteHome: options.remoteHome }),
    ],
  })
}

/**
 * What provisioning would do on one machine, in dependency order. A step is `done` from the machine's own facts, so a
 * second run never repeats work, and `blocked` names what a person must change on that machine (never installed here).
 */
const planProvision = ({ facts, options }: { readonly facts: RemoteFacts; readonly options: ProvisionOptions }): ProvisionPlanStep[] => {
  const official = RemoteDoctor.officialNodePath({ nodes: facts.fnm.nodes, minimum: options.nodeVersion })
  const nodePath = facts.node.nix ? official : (facts.node.path ?? official)
  return [
    planNode({ facts, options }),
    planCheckout({ facts, options }),
    planInstall({ facts, nodePath, options }),
    planBuild({ facts, nodePath, options }),
    planCli({ facts, nodePath, options }),
    planProfile({ facts, nodePath, options }),
    planRuntime({ facts, nodePath, options }),
  ]
}

export interface ProvisionStepRun {
  readonly id: ProvisionStepId
  readonly ok: boolean
  readonly state: 'ran' | 'failed' | 'skipped' | 'blocked'
  readonly detail: string
  readonly stdout: string
  readonly stderr: string
}

export interface ProvisionRun {
  readonly executed: ProvisionStepRun[]
  readonly remaining: ProvisionStepId[]
}

const stepTimeouts: Record<ProvisionStepId, number> = {
  node: 300_000,
  checkout: 300_000,
  install: 600_000,
  build: 900_000,
  cli: 300_000,
  profile: 300_000,
  runtime: 180_000,
}

const runStep = async ({
  sshTarget,
  step,
  signal,
}: {
  readonly sshTarget: string
  readonly step: ProvisionPlanStep
  readonly signal?: AbortSignal | undefined
}): Promise<ProvisionStepRun> => {
  let stdout = ''
  let stderr = ''
  for (const command of step.commands) {
    const result = await RemoteExec.run({ sshTarget, command, timeoutMs: stepTimeouts[step.id], signal })
    stdout = `${stdout}${result.stdout}`.slice(-16_000)
    stderr = `${stderr}${result.stderr}`.slice(-8_000)
    if (!result.ok) {
      return {
        id: step.id,
        ok: false,
        state: 'failed',
        detail: result.timedOut ? `${step.id} timed out` : `${step.id} exited ${result.code ?? 'unknown'}`,
        stdout,
        stderr,
      }
    }
  }
  return { id: step.id, ok: true, state: 'ran', detail: step.reason, stdout, stderr }
}

/**
 * Run named provisioning steps. `confirm: 'all'` runs every named step in order; `confirm: 'next'` runs exactly one
 * step per call, so every step is its own explicit opt-in. Nothing runs while `dryRun` is set.
 */
const runProvision = async ({
  sshTarget,
  facts,
  options,
  steps,
  confirm,
  dryRun,
  signal,
}: {
  readonly sshTarget: string
  readonly facts: RemoteFacts
  readonly options: ProvisionOptions
  readonly steps: readonly ProvisionStepId[]
  readonly confirm: 'all' | 'next'
  readonly dryRun: boolean
  readonly signal?: AbortSignal | undefined
}): Promise<ProvisionRun> => {
  const plan = planProvision({ facts, options }).filter(step => steps.includes(step.id))
  if (dryRun) return { executed: [], remaining: plan.filter(step => step.state !== 'done').map(step => step.id) }
  const runnable = plan.filter(step => steps.includes(step.id))
  const selected = confirm === 'next' ? runnable.slice(0, 1) : runnable
  const executed: ProvisionStepRun[] = []
  for (const step of selected) {
    if (step.state === 'done') {
      executed.push({ id: step.id, ok: true, state: 'skipped', detail: step.reason, stdout: '', stderr: '' })
      continue
    }
    if (step.state === 'blocked') {
      executed.push({ id: step.id, ok: false, state: 'blocked', detail: step.reason, stdout: '', stderr: '' })
      break
    }
    const result = await runStep({ sshTarget, step, signal })
    executed.push(result)
    if (!result.ok) break
  }
  const done = new Set(executed.filter(result => result.ok).map(result => result.id))
  return { executed, remaining: runnable.filter(step => !done.has(step.id)).map(step => step.id) }
}

export class RemoteProvision {
  static readonly stepIds = provisionStepIds
  static readonly plan = planProvision
  static readonly run = runProvision
}
