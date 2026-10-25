import { readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { spawn } from 'node:child_process'
import { parse } from 'yaml'
import { DEFAULT_COMPATIBILITY, classifyCompatibility } from '../compat/index.js'
import { DshxError } from '../diagnostics.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { runProjectDsh } from './command.js'
import type {
  DshCommandResult,
  DshCommandRunner,
  PreparedProjectProfile,
  ProfileOrchestratorOptions,
  ProfileProject,
  ProjectProfileLink,
  ResolvedDshInstallation,
} from './types.js'

const VERSION_TIMEOUT_MS = 15_000
const INSPECT_TIMEOUT_MS = 30_000
const ADD_TIMEOUT_MS = 120_000
const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
const DSH_NOT_FOUND_PATTERN = /(?:command ["']?dsh["']? not found|dsh: (?:command )?not found|not recognized as an internal or external command)/i

interface InstalledDependency {
  packageId: string
  path: string
}

interface InstalledProfile {
  dependencies: InstalledDependency[]
  profileRoot?: string
}

function runnerOf(options: ProfileOrchestratorOptions): DshCommandRunner {
  return options.runner ?? runProjectDsh
}

function environmentOf(options: ProfileOrchestratorOptions): NodeJS.ProcessEnv {
  return { ...process.env, ...options.env }
}

function commandDetail(result: DshCommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  return detail === '' ? `exit code ${result.exitCode ?? 'unknown'}` : detail.slice(0, 2_000)
}

function isDshMissing(result: DshCommandResult): boolean {
  return (
    result.failureCode === 'ENOENT' ||
    (result.exitCode === undefined && result.stdout.trim() === '' && result.stderr.trim() === '') ||
    DSH_NOT_FOUND_PATTERN.test(result.stderr) ||
    DSH_NOT_FOUND_PATTERN.test(result.stdout)
  )
}

function validateProfileName(project: ProfileProject): void {
  const profile = project.profile
  if (profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..' || profile === 'node_modules') {
    throw new DshxError('DSHX4301', `Invalid DSH profile name ${JSON.stringify(profile)}.`, {
      file: project.configFile ?? project.packageFile,
      hint: 'Use a flat profile name such as "web", without path separators or reserved directory names.',
    })
  }
}

async function runDsh(project: ProfileProject, args: readonly string[], timeoutMs: number, options: ProfileOrchestratorOptions): Promise<DshCommandResult> {
  try {
    return await runnerOf(options)(args, {
      cwd: project.root,
      env: environmentOf(options),
      timeoutMs,
      ...(options.executable !== undefined && { executable: options.executable }),
    })
  } catch (cause) {
    return { stdout: '', stderr: '', cause }
  }
}

/** Detect the project-local DSH CLI and select the compatibility adapter. */
const resolveDshInstallation = async (project: ProfileProject, options: ProfileOrchestratorOptions = {}): Promise<ResolvedDshInstallation> => {
  const result = await runDsh(project, ['--version'], VERSION_TIMEOUT_MS, options)
  if (result.exitCode !== 0) {
    if (isDshMissing(result)) {
      throw new DshxError('DSHX5001', 'No usable DSH CLI is available in the project or on PATH.', {
        cause: result.cause,
        file: project.packageFile,
        hint: 'Install @deepseek-ai/dsh as a project devDependency or make the official dsh command available on PATH.',
      })
    }
    throw new DshxError('DSHX5002', `Failed to read the installed DSH version: ${commandDetail(result)}`, {
      cause: result.cause,
      file: project.packageFile,
      hint: 'Run the project-local or PATH-resolved "dsh --version" command and fix the reported failure.',
    })
  }
  const match = VERSION_PATTERN.exec(result.stdout.trim())
  if (match?.[1] === undefined) {
    throw new DshxError('DSHX5002', `DSH returned an invalid version string: ${JSON.stringify(result.stdout.trim())}.`, {
      file: project.packageFile,
      hint: 'Ensure the resolved official dsh CLI prints one semantic version.',
    })
  }
  const version = match[1]
  const resolution = classifyCompatibility(version)
  if (resolution?.support === 'verified') {
    return {
      version,
      executable: result.executable ?? 'local',
      support: 'verified',
      adapterId: resolution.compatibility.id,
      protocolGeneration: resolution.compatibility.protocolGeneration,
      supportedRange: resolution.compatibility.dshRange,
      compatibility: resolution.compatibility,
      diagnostics: [],
    }
  }
  if (resolution?.support === 'compatible' || resolution?.support === 'experimental') {
    const experimental = resolution.support === 'experimental'
    const diagnostic: DshxDiagnostic = {
      code: 'DSHX5101',
      severity: 'warning',
      message: experimental
        ? `DSH ${version} is an unverified prerelease in the ${resolution.compatibility.protocolGeneration} compatibility generation; continuing experimentally with the ${resolution.compatibility.id} adapter.`
        : `DSH ${version} is within the ${resolution.compatibility.protocolGeneration} compatibility generation but has not been verified by DSHX; continuing with the ${resolution.compatibility.id} adapter.`,
      file: project.packageFile,
      hint: `Run the DSHX real-runtime smoke for ${version}; verified boundaries are ${resolution.compatibility.verified.minimum} and ${resolution.compatibility.verified.latest}.`,
    }
    return {
      version,
      executable: result.executable ?? 'local',
      support: resolution.support,
      adapterId: resolution.compatibility.id,
      protocolGeneration: resolution.compatibility.protocolGeneration,
      supportedRange: resolution.compatibility.dshRange,
      compatibility: resolution.compatibility,
      diagnostics: [diagnostic],
    }
  }
  if (!project.compatibility.allowUnsupported) {
    throw new DshxError('DSHX5101', `Unsupported DSH version ${JSON.stringify(version)}.`, {
      file: project.packageFile,
      hint: `Install a DSH version in ${DEFAULT_COMPATIBILITY.dshRange}, or set compatibility.allowUnsupported to true to continue at your own risk.`,
    })
  }
  const diagnostic: DshxDiagnostic = {
    code: 'DSHX5101',
    severity: 'warning',
    message: `DSH ${version} is outside the supported range ${DEFAULT_COMPATIBILITY.dshRange}; DSHX is continuing with the ${DEFAULT_COMPATIBILITY.id} adapter.`,
    file: project.packageFile,
    hint: `Use a verified DSH boundary (${DEFAULT_COMPATIBILITY.verified.minimum} or ${DEFAULT_COMPATIBILITY.verified.latest}) for verified behavior.`,
  }
  return {
    version,
    executable: result.executable ?? 'local',
    support: 'unsupported',
    adapterId: DEFAULT_COMPATIBILITY.id,
    protocolGeneration: DEFAULT_COMPATIBILITY.protocolGeneration,
    supportedRange: DEFAULT_COMPATIBILITY.dshRange,
    compatibility: DEFAULT_COMPATIBILITY,
    diagnostics: [diagnostic],
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The pnpm install that materializes the profile's `link:` dependencies. The
 * failure detail is bounded: an install log names its cause in the tail.
 */
const defaultInstall = (profileRoot: string, options: ProfileOrchestratorOptions) => async (): Promise<void> => {
  const result = await new Promise<{ readonly code: number; readonly detail: string }>(resolve => {
    const child = spawn('pnpm', ['install', '--prefer-offline'], {
      cwd: profileRoot,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let detail = ''
    child.stdout.on('data', (chunk: Buffer) => {
      detail += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      detail += chunk.toString('utf8')
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: -1, detail: `pnpm install did not finish within ${String(ADD_TIMEOUT_MS)}ms` })
    }, ADD_TIMEOUT_MS)
    child.once('exit', code => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, detail: detail.slice(-800) })
    })
  })
  if (result.code !== 0) {
    throw new DshxError('DSHX4304', `Failed to install the profile after linking the project: ${result.detail}`, {
      file: join(profileRoot, 'package.json'),
      hint: `Run "pnpm install" in ${profileRoot} and fix the reported failure.`,
    })
  }
}

function duplicateLoaderIds(project: ProfileProject, source: string): string[] {
  let value: unknown
  try {
    value = parse(source, {
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (expression: string) => expression }],
    })
  } catch (cause) {
    throw new DshxError('DSHX4302', 'DSH returned invalid YAML while composing the target profile.', {
      cause,
      file: project.packageFile,
      hint: `Run "dsh --profile ${project.profile} --dump-config" and fix the reported configuration error.`,
    })
  }
  if (!Array.isArray(value)) {
    throw new DshxError('DSHX4302', 'DSH returned an unexpected profile composition document.', {
      file: project.packageFile,
      hint: `Run "dsh --profile ${project.profile} --dump-config" and inspect its output.`,
    })
  }

  // Check the profile-level rows only. Preset groups intentionally reuse
  // child ids and appear nested under their owning top-level Loader row.
  const ids = value.flatMap(entry => (isObject(entry) && typeof entry.id === 'string' ? [entry.id] : []))
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
}

async function inspectLoaderIds(project: ProfileProject, options: ProfileOrchestratorOptions): Promise<void> {
  // DSH's dump uses the same bundle patch composition as web boot, but does not
  // start a server or activate any plugins.
  const result = await runDsh(project, ['--profile', project.profile, '--dump-config'], INSPECT_TIMEOUT_MS, options)
  if (result.exitCode !== 0) {
    throw new DshxError('DSHX4302', `Failed to compose DSH profile ${JSON.stringify(project.profile)}: ${commandDetail(result)}`, {
      cause: result.cause,
      file: project.packageFile,
      hint: `Run "dsh --profile ${project.profile} --dump-config" and fix the reported profile error.`,
    })
  }

  const duplicates = duplicateLoaderIds(project, result.stdout)
  if (duplicates.length > 0) {
    throw new DshxError('DSHX4306', `DSH profile ${JSON.stringify(project.profile)} has duplicate Loader ids: ${duplicates.join(', ')}.`, {
      file: project.packageFile,
      hint: 'Give each inserted top-level Loader row a unique id. For scoped packages, retain the scope in the id (for example, @dshfiles/foo -> dshfiles-foo).',
    })
  }
}

function packagePathSegments(packageId: string): string[] | undefined {
  const segments = packageId.split('/')
  if (segments.length === 1 && !packageId.startsWith('@') && segments[0] !== '' && segments[0] !== '.' && segments[0] !== '..') return segments
  if (segments.length === 2 && segments[0]?.startsWith('@') && segments[0].length > 1 && segments[1] !== '' && segments[1] !== '.' && segments[1] !== '..') {
    return segments
  }
  return undefined
}

async function resolveDependencyPath(project: ProfileProject, packageId: string, rawPath: string, profileRoot: string | undefined): Promise<string> {
  const installedPath = await realpath(rawPath).catch(() => undefined)
  if (installedPath !== undefined) return installedPath

  // DSH can report pnpm's virtual-store path when the profile uses the
  // supported hoisted linker. In that layout the package is under node_modules.
  const segments = packagePathSegments(packageId)
  const hoistedPath =
    profileRoot === undefined || segments === undefined ? undefined : await realpath(join(profileRoot, 'node_modules', ...segments)).catch(() => undefined)
  if (hoistedPath !== undefined) return hoistedPath

  throw new DshxError('DSHX4302', `Profile dependency ${JSON.stringify(packageId)} points to a missing path: ${rawPath}`, {
    file: project.packageFile,
    hint: `Repair the profile installation for ${packageId} and retry.`,
  })
}

async function parseDependencies(project: ProfileProject, source: string): Promise<InstalledProfile> {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (cause) {
    throw new DshxError('DSHX4302', 'DSH returned invalid JSON while inspecting the target profile.', {
      cause,
      file: project.packageFile,
      hint: `Run "pnpm exec dsh plugin --profile ${project.profile} list --depth 0 --json" and inspect its output.`,
    })
  }
  if (!Array.isArray(value) || value.length !== 1 || !isObject(value[0])) {
    throw new DshxError('DSHX4302', 'DSH returned an unexpected profile dependency document.', {
      file: project.packageFile,
      hint: 'Update DSHX or use the verified DSH version before linking this project.',
    })
  }
  const rawDependencies = value[0].dependencies
  const rawProfileRoot = value[0].path
  let profileRoot: string | undefined
  if (rawProfileRoot !== undefined) {
    if (typeof rawProfileRoot !== 'string' || !isAbsolute(rawProfileRoot)) {
      throw new DshxError('DSHX4302', 'The inspected profile root must be an absolute path.', {
        file: project.packageFile,
        hint: `Run "pnpm exec dsh plugin --profile ${project.profile} list --depth 0 --json" and inspect its output.`,
      })
    }
    profileRoot = await realpath(rawProfileRoot).catch((cause: unknown) => {
      throw new DshxError('DSHX4302', `DSH profile root does not exist: ${rawProfileRoot}`, {
        cause,
        file: project.packageFile,
        hint: `Repair profile ${project.profile} and retry.`,
      })
    })
  }
  if (rawDependencies === undefined) return { dependencies: [], ...(profileRoot !== undefined && { profileRoot }) }
  if (!isObject(rawDependencies)) {
    throw new DshxError('DSHX4302', 'The inspected profile dependencies must be an object.', {
      file: project.packageFile,
      hint: `Repair the profile through "pnpm exec dsh plugin --profile ${project.profile}" commands.`,
    })
  }
  const dependencies = await Promise.all(
    Object.entries(rawDependencies).map(async ([packageId, raw]) => {
      if (!isObject(raw) || typeof raw.path !== 'string' || raw.path.trim() === '' || !isAbsolute(raw.path)) {
        throw new DshxError('DSHX4302', `Profile dependency ${JSON.stringify(packageId)} has no valid resolved path.`, {
          file: project.packageFile,
          hint: `Remove and reinstall ${packageId} through the official dsh plugin command.`,
        })
      }
      const path = await resolveDependencyPath(project, packageId, raw.path, profileRoot)
      return { packageId, path }
    }),
  )
  return { dependencies, ...(profileRoot !== undefined && { profileRoot }) }
}

/** Inspect whether this exact package id and real project path are linked. */
const inspectProjectProfile = async (project: ProfileProject, options: ProfileOrchestratorOptions = {}): Promise<ProjectProfileLink> => {
  validateProfileName(project)
  const compatibility = options.compatibility ?? DEFAULT_COMPATIBILITY
  if (compatibility.profile.listCommand !== 'plugin-list-json') {
    throw new DshxError('DSHX4302', `The selected DSH adapter cannot inspect Profile ${JSON.stringify(project.profile)}.`, {
      file: project.packageFile,
      hint: 'Use a DSHX adapter that supports the official JSON Profile list command.',
    })
  }
  const args = ['plugin', '--profile', project.profile, 'list', '--depth', '0', '--json'] as const
  const result = await runDsh(project, args, INSPECT_TIMEOUT_MS, options)
  if (result.exitCode !== 0) {
    throw new DshxError('DSHX4302', `Failed to inspect DSH profile ${JSON.stringify(project.profile)}: ${commandDetail(result)}`, {
      cause: result.cause,
      file: project.packageFile,
      hint: `Run "pnpm exec dsh plugin --profile ${project.profile} list --depth 0 --json" and fix the reported failure.`,
    })
  }
  const { dependencies, profileRoot } = await parseDependencies(project, result.stdout)
  const desired = dependencies.find(dependency => dependency.packageId === project.packageId)
  const aliases = dependencies.filter(dependency => dependency.packageId !== project.packageId && dependency.path === project.root)
  if (desired !== undefined && desired.path !== project.root) {
    throw new DshxError('DSHX4303', `Package ${JSON.stringify(project.packageId)} is already installed from another path: ${desired.path}`, {
      file: project.packageFile,
      hint: `Run "pnpm exec dsh plugin --profile ${project.profile} remove ${project.packageId}", then retry from this project.`,
    })
  }
  if (aliases.length > 0) {
    const oldNames = aliases.map(dependency => dependency.packageId)
    throw new DshxError('DSHX4303', `This project path is already linked under a different package name: ${oldNames.join(', ')}.`, {
      file: project.packageFile,
      hint: `Run "pnpm exec dsh plugin --profile ${project.profile} remove ${oldNames.join(' ')}", then retry.`,
    })
  }
  await inspectLoaderIds(project, options)
  return {
    state: desired === undefined ? 'absent' : 'linked',
    profile: project.profile,
    packageId: project.packageId,
    root: project.root,
    ...(profileRoot !== undefined && { profileRoot }),
  }
}

/**
 * Install the project into the profile through the repository-proven local
 * route: a `link:` manifest dependency plus a package-manager install.
 *
 * `dsh plugin add <path>` resolves the directory through registry name
 * resolution and refuses essentially every local layout, so linking a project
 * means editing the profile's own package.json — preserving every unrelated
 * dependency, bundle, and config row — and letting pnpm materialize it. The
 * re-inspection afterwards is what proves the link rather than trusting the
 * install's exit code.
 */
const ensureProjectProfile = async (project: ProfileProject, options: ProfileOrchestratorOptions = {}): Promise<PreparedProjectProfile> => {
  validateProfileName(project)
  const dsh = await resolveDshInstallation(project, options)
  const existing = await inspectProjectProfile(project, {
    ...options,
    compatibility: dsh.compatibility,
    ...(dsh.executable !== undefined && { executable: dsh.executable }),
  })
  if (existing.state === 'linked') {
    return {
      profile: project.profile,
      packageId: project.packageId,
      root: project.root,
      dsh,
      link: 'existing',
      diagnostics: dsh.diagnostics,
    }
  }
  if (existing.profileRoot === undefined) {
    throw new DshxError('DSHX4304', `Profile ${JSON.stringify(project.profile)} has no directory DSH reported, so the project cannot be linked.`, {
      file: project.packageFile,
      hint: `Boot the profile once, or create it under the profiles root with a package.json, then retry.`,
    })
  }
  const profileRoot = existing.profileRoot
  const manifestFile = join(profileRoot, 'package.json')
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>
  } catch (cause) {
    throw new DshxError('DSHX4304', `The profile manifest is not valid JSON: ${manifestFile}`, {
      cause,
      file: project.packageFile,
      hint: 'Repair the profile manifest before linking this project.',
    })
  }
  const dependencies = isObject(manifest.dependencies) ? { ...manifest.dependencies } : {}
  const existingLink = dependencies[project.packageId]
  if (typeof existingLink === 'string' && existingLink !== `link:${project.root}`) {
    throw new DshxError('DSHX4303', `The profile already links ${JSON.stringify(project.packageId)} from ${existingLink}.`, {
      file: project.packageFile,
      hint: `Remove the dependency from ${manifestFile} if it is stale, then retry.`,
    })
  }
  const dshConfig = isObject(manifest.dsh) ? { ...manifest.dsh } : {}
  const profileConfig = isObject(dshConfig.profile) ? { ...dshConfig.profile } : {}
  const bundles = Array.isArray(profileConfig.bundles) ? [...(profileConfig.bundles as unknown[])] : []
  const withoutProject = bundles.filter(bundle => bundle !== project.packageId)
  dependencies[project.packageId] = `link:${project.root}`
  manifest.dependencies = dependencies
  profileConfig.bundles = [...withoutProject, project.packageId]
  dshConfig.profile = profileConfig
  manifest.dsh = dshConfig
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const install = options.install ?? defaultInstall(profileRoot, options)
  try {
    await install(profileRoot)
  } catch (cause) {
    if (cause instanceof DshxError) throw cause
    throw new DshxError(
      'DSHX4304',
      `Failed to install the profile after linking ${JSON.stringify(project.packageId)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
        file: manifestFile,
        hint: `Run "pnpm install" in ${profileRoot} and fix the reported failure.`,
      },
    )
  }
  const installed = await inspectProjectProfile(project, {
    ...options,
    compatibility: dsh.compatibility,
    ...(dsh.executable !== undefined && { executable: dsh.executable }),
  })
  if (installed.state !== 'linked') {
    throw new DshxError('DSHX4304', 'The profile install finished, but the project is still absent from the profile.', {
      file: manifestFile,
      hint: `Inspect the profile with "pnpm exec dsh plugin --profile ${project.profile} list --depth 0 --json".`,
    })
  }
  return {
    profile: project.profile,
    packageId: project.packageId,
    root: project.root,
    dsh,
    link: 'added',
    diagnostics: dsh.diagnostics,
  }
}

export class ProfileOrchestrator {
  static readonly resolveDshInstallation = resolveDshInstallation
  static readonly inspectProjectProfile = inspectProjectProfile
  static readonly ensureProjectProfile = ensureProjectProfile
}
