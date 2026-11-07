import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { readFile, rm, rmdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { decodeJson, jsonObjectSchema } from '../json.js'
import { runProjectDsh } from '../profile/command.js'
import type { DshCommandRunner } from '../profile/types.js'
import { ScaffoldFilePlan, type FilePlan } from '../scaffold/common.js'
import { RegistryClient, type LoadedItem } from './client.js'
import { RegistryError, type SourceItem, type SourceRecord } from './format.js'
import { RegistryRecords } from './records.js'

const CONFIG_FILE = 'dshx.config.ts'
/** Build configuration and tool state decide what runs; copied source never rewrites them silently. */
const FORBIDDEN_TARGET = /^(?:package\.json|dshx\.config\.[cm]?[jt]s|cordis\.patch\.yml|\.dshx-registry\.json|node_modules(?:\/|$)|\.[^/]+\/)/u

export interface SourceTarget {
  readonly project: string
  readonly dshHome: string
  readonly force: boolean
  readonly dryRun: boolean
}

export interface SourceDependencies {
  readonly runDsh?: DshCommandRunner
}

export interface SourceItemPlan {
  readonly action: 'add' | 'update' | 'remove'
  readonly item: string
  readonly itemUrl: string | null
  readonly project: string
  readonly versions: { readonly before: string | null; readonly after: string | null }
  readonly files: readonly { readonly target: string; readonly change: string }[]
  readonly dependencies: readonly string[]
  readonly warnings: readonly string[]
  readonly docs: string | null
  /** Items this one pulled in, in install order. */
  readonly required: readonly SourceItemPlan[]
  readonly dryRun: boolean
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const openProject = (project: string): string => {
  const root = resolve(project)
  if (!existsSync(join(root, CONFIG_FILE)))
    throw new RegistryError(`${root} is not a dshx plugin project (no ${CONFIG_FILE}).`, 'Pass --project <dir>, or create one with "dshx create".')
  return root
}

/** Reject a target that leaves the project, directly or through a symlink already on disk. */
const targetPath = (root: string, target: string): string => {
  const refuse = (reason: string): never => {
    throw new RegistryError(`The item targets ${target}, ${reason}.`, 'Nothing was written. Report it to the registry owner; this item is unsafe to install.')
  }
  const path = resolve(root, target)
  if (!ScaffoldFilePlan.insideProject(root, path)) refuse('which is outside the project')
  if (FORBIDDEN_TARGET.test(relative(root, path).split(sep).join('/'))) refuse('a build or tool file that copied source must not rewrite')
  let existing = dirname(path)
  while (!existsSync(existing)) existing = dirname(existing)
  const real = realpathSync(existing)
  const realRoot = realpathSync(root)
  if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) refuse('which resolves outside the project through a symlink')
  return path
}

const assertEngines = async (item: SourceItem, root: string, target: SourceTarget, dependencies: SourceDependencies): Promise<void> => {
  if (item.engines.dsh === undefined || target.force) return
  const result = await (dependencies.runDsh ?? runProjectDsh)(['--version'], { cwd: root, env: process.env, timeoutMs: 30_000 })
  const running = RegistryClient.parseDshVersion(result.stdout)
  if (running === undefined)
    throw new RegistryError(
      `Could not read the DSH version to check ${item.name} against engines.dsh ${item.engines.dsh}.`,
      'Install DSH, or pass --force to skip the check.',
    )
  if (!RegistryClient.enginesAllow(item.engines.dsh, running))
    throw new RegistryError(
      `${item.name} needs DSH ${item.engines.dsh}; this is ${running}.`,
      'Use a release of the item for this DSH, or pass --force to copy it anyway.',
    )
}

interface Difference {
  readonly plan: readonly FilePlan[]
  readonly files: readonly { readonly target: string; readonly change: string }[]
  readonly remove: readonly string[]
  readonly conflicts: readonly string[]
  readonly kept: readonly string[]
}

/** Compare the item with the project: a file is ours to replace only while it still holds what we wrote. */
const differ = async (root: string, item: SourceItem, previous: SourceRecord | undefined, others: readonly SourceRecord[]): Promise<Difference> => {
  const recorded = new Map(previous?.files.map(file => [file.target, file.sha256]))
  const plan: FilePlan[] = []
  const files: { target: string; change: string }[] = []
  const conflicts: string[] = []
  for (const { target, content } of item.files) {
    const path = targetPath(root, target)
    const before = await ScaffoldFilePlan.readOptionalFile(path)
    if (before === content) continue
    const change = before === undefined ? 'new file' : 'replaced'
    const ours = before !== undefined && recorded.get(target) === sha256(before)
    if (before !== undefined && !ours)
      conflicts.push(others.some(other => other.files.some(file => file.target === target)) ? `${target} (owned by another item)` : target)
    plan.push(before === undefined ? { file: path, after: content } : { file: path, before, after: content })
    files.push({ target, change })
  }
  const remove: string[] = []
  const kept: string[] = []
  const wanted = new Set(item.files.map(file => file.target))
  for (const file of previous?.files ?? []) {
    if (wanted.has(file.target)) continue
    const path = targetPath(root, file.target)
    const current = await ScaffoldFilePlan.readOptionalFile(path)
    if (current === undefined) continue
    if (sha256(current) === file.sha256) {
      remove.push(file.target)
      files.push({ target: file.target, change: 'no longer in the item; removed' })
    } else kept.push(file.target)
  }
  return { plan, files, remove, conflicts, kept }
}

const manifestWithDependencies = async (root: string, item: SourceItem) => {
  const path = join(root, 'package.json')
  const before = await readFile(path, 'utf8')
  const manifest = decodeJson(jsonObjectSchema, before)
  const current = decodeJson(jsonObjectSchema, JSON.stringify(manifest.dependencies ?? {}))
  const missing = Object.entries(item.dependencies).filter(([name]) => current[name] === undefined)
  const warnings = Object.entries(item.dependencies)
    .filter(([name, version]) => current[name] !== undefined && current[name] !== version)
    .map(([name, version]) => `${item.name} wants ${name}@${version}; the project keeps ${String(current[name])}.`)
  const added = missing.map(([name, version]) => `${name}@${version}`)
  if (missing.length === 0) return { plan: [], added, warnings }
  const after = `${JSON.stringify({ ...manifest, dependencies: { ...current, ...Object.fromEntries(missing) } }, null, 2)}\n`
  return { plan: [{ file: path, before, after }], added, warnings }
}

const pruneEmptyDirectories = async (root: string, path: string): Promise<void> => {
  let directory = dirname(path)
  while (ScaffoldFilePlan.insideProject(root, directory)) {
    const removed = await rmdir(directory).then(
      () => true,
      () => false,
    )
    if (!removed) return
    directory = dirname(directory)
  }
}

const removeFiles = async (root: string, targets: readonly string[]): Promise<void> => {
  for (const target of targets) {
    const path = targetPath(root, target)
    await rm(path, { force: true })
    await pruneEmptyDirectories(root, path)
  }
}

const installOne = async (
  root: string,
  loaded: LoadedItem,
  item: SourceItem,
  target: SourceTarget,
  dependencies: SourceDependencies,
  required: readonly string[],
): Promise<SourceItemPlan> => {
  await assertEngines(item, root, target, dependencies)
  const records = await RegistryRecords.readProject(root)
  const previous = records[item.name]
  if (previous !== undefined && previous.itemUrl !== loaded.itemUrl && !target.force)
    throw new RegistryError(
      `${item.name} is already installed from ${previous.itemUrl}.`,
      `Run "dshx remove ${item.name} --project ${root}" first, or pass --force to switch origin.`,
    )
  const others = Object.entries(records).flatMap(([name, record]) => (name === item.name ? [] : [record]))
  const difference = await differ(root, item, previous, others)
  if (difference.conflicts.length > 0 && !target.force)
    throw new RegistryError(
      `${item.name} would overwrite files it does not own: ${difference.conflicts.join(', ')}.`,
      'Nothing was written. Keep your edits by moving them aside, or pass --force to replace them.',
    )
  const manifest = await manifestWithDependencies(root, item)
  if (!target.dryRun) {
    await ScaffoldFilePlan.applyFilePlan([...difference.plan, ...manifest.plan])
    await removeFiles(root, difference.remove)
    const record: SourceRecord = {
      address: loaded.address,
      itemUrl: loaded.itemUrl,
      version: item.version,
      files: item.files.map(file => ({ target: file.target, sha256: sha256(file.content) })),
      requires: [...required],
    }
    await RegistryRecords.writeProject(root, { ...records, [item.name]: record })
  }
  return {
    action: 'add',
    item: item.name,
    itemUrl: loaded.itemUrl,
    project: root,
    versions: { before: previous?.version ?? null, after: item.version },
    files: difference.files,
    dependencies: manifest.added,
    warnings: [...manifest.warnings, ...difference.kept.map(file => `${file} left the item but holds local edits, so it stays.`)],
    docs: item.docs ?? null,
    required: [],
    dryRun: target.dryRun,
  }
}

const installGraph = async (root: LoadedItem, target: SourceTarget, dependencies: SourceDependencies): Promise<SourceItemPlan> => {
  const project = openProject(target.project)
  const plans: SourceItemPlan[] = []
  const graph = await RegistryClient.resolveGraph(root)
  for (const loaded of graph) {
    if (loaded.item.type !== 'dsh:source')
      throw new RegistryError(`${loaded.item.name} is a built plugin, not source.`, 'Install plugin items into a profile: dshx add <item> --profile <name>.')
    const names = (await RegistryClient.resolveGraph(loaded)).filter(entry => entry !== loaded).map(entry => entry.item.name)
    plans.push(await installOne(project, loaded, loaded.item, target, dependencies, names))
  }
  const plan = plans.at(-1)
  if (plan === undefined) throw new Error('A registry graph always contains its root item.')
  return { ...plan, required: plans.slice(0, -1) }
}

const findItem = (records: Readonly<Record<string, SourceRecord>>, spec: string, cwd: string) => {
  const direct = records[spec]
  if (direct !== undefined) return [spec, direct] as const
  const address = RegistryClient.parseAddress(spec, cwd)
  const url = address?.kind === 'location' ? address.url : undefined
  return Object.entries(records).find(([, record]) => record.address === spec || record.itemUrl === url)
}

const update = async (spec: string, cwd: string, target: SourceTarget, dependencies: SourceDependencies): Promise<SourceItemPlan> => {
  const root = openProject(target.project)
  const found = findItem(await RegistryRecords.readProject(root), spec, cwd)
  if (found === undefined) throw new RegistryError(`${root} has no registry item "${spec}".`, `Install it with "dshx add <address> --project ${root}".`)
  const [name, record] = found
  const loaded = await RegistryClient.load({ kind: 'location', spec: record.address, url: record.itemUrl }, target.dshHome)
  if (loaded.item.type !== 'dsh:source' || loaded.item.name !== name)
    throw new RegistryError(
      `${record.itemUrl} no longer describes ${name}.`,
      `Nothing changed. Run "dshx remove ${name} --project ${root}" and install what the registry now offers.`,
    )
  return { ...(await installGraph(loaded, target, dependencies)), action: 'update', versions: { before: record.version, after: loaded.item.version } }
}

const remove = async (spec: string, cwd: string, target: SourceTarget): Promise<SourceItemPlan> => {
  const root = openProject(target.project)
  const records = await RegistryRecords.readProject(root)
  const found = findItem(records, spec, cwd)
  if (found === undefined)
    return {
      action: 'remove',
      item: spec,
      itemUrl: null,
      project: root,
      versions: { before: null, after: null },
      files: [],
      dependencies: [],
      warnings: [],
      docs: null,
      required: [],
      dryRun: target.dryRun,
    }
  const [name, record] = found
  const files: { target: string; change: string }[] = []
  const warnings: string[] = []
  const deletions: string[] = []
  for (const file of record.files) {
    const current = await ScaffoldFilePlan.readOptionalFile(targetPath(root, file.target))
    if (current === undefined) continue
    if (sha256(current) === file.sha256 || target.force) {
      deletions.push(file.target)
      files.push({ target: file.target, change: 'removed' })
    } else warnings.push(`${file.target} holds local edits, so it stays; pass --force to delete it.`)
  }
  const dependents = Object.entries(records).filter(([other, candidate]) => other !== name && candidate.requires.includes(name))
  if (dependents.length > 0) warnings.push(`${dependents.map(([other]) => other).join(', ')} declared ${name} as a registry dependency and may stop compiling.`)
  if (record.requires.length > 0) warnings.push(`Its registry dependencies stay, because something else may use them: ${record.requires.join(', ')}.`)
  warnings.push('npm dependencies the item added stay in package.json; another file may import them.')
  if (!target.dryRun) {
    await removeFiles(root, deletions)
    const { [name]: _dropped, ...rest } = records
    await RegistryRecords.writeProject(root, rest)
  }
  return {
    action: 'remove',
    item: name,
    itemUrl: record.itemUrl,
    project: root,
    versions: { before: record.version, after: null },
    files,
    dependencies: [],
    warnings,
    docs: null,
    required: [],
    dryRun: target.dryRun,
  }
}

/** The build refuses what an install would, so a bad target fails for its author rather than its users. */
const assertTarget = (target: string): void => {
  const root = resolve(sep, 'project')
  const path = resolve(root, target)
  if (!ScaffoldFilePlan.insideProject(root, path) || FORBIDDEN_TARGET.test(relative(root, path).split(sep).join('/')))
    throw new RegistryError(
      `${target} is not a valid source target.`,
      'Target a path inside the plugin project, away from its package.json, dshx config, cordis.patch.yml and dot-directories.',
    )
}

export class SourceItems {
  static readonly add = installGraph
  static readonly update = update
  static readonly remove = remove
  static readonly assertTarget = assertTarget
}
