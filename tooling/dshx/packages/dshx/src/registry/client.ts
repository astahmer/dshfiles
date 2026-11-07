import { execa } from 'execa'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import semver from 'semver'
import writeFileAtomic from 'write-file-atomic'
import * as Schema from 'effect/Schema'
import { decodeJson, decodeJsonSafe, jsonObjectSchema } from '../json.js'
import {
  REGISTRY_SCHEMA_VERSION,
  RegistryError,
  registryAliasesSchema,
  registryIndexSchema,
  registryItemSchema,
  type RegistryIndex,
  type RegistryItem,
  type TarballSource,
} from './format.js'

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_TARBALL_BYTES = 64 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000
const ALIASES_FILE = 'dshx-registries.json'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Specifier protocols `dshx add` and pnpm already give a meaning; `link:foo` must never read as an alias. */
const RESERVED_ALIASES = new Set(['link', 'file', 'npm', 'jsr', 'git', 'github', 'gitlab', 'bitbucket', 'workspace', 'catalog', 'http', 'https'])

const aliasPattern = /^[a-z][a-z0-9-]*$/u
const aliasAddressPattern = /^([a-z][a-z0-9-]*):([a-z0-9][a-z0-9-]*)$/u

export type RegistryAddress =
  | { readonly kind: 'location'; readonly spec: string; readonly url: string }
  | { readonly kind: 'alias'; readonly spec: string; readonly alias: string; readonly item: string }

export interface LoadedItem {
  readonly item: RegistryItem
  readonly itemUrl: string
  /** How the user named it; recorded so `update` and `remove` accept the same spelling. */
  readonly address: string
}

const toLocation = (input: string, cwd: string): string => {
  if (/^https?:\/\//iu.test(input) || input.startsWith('file:')) return input
  return pathToFileURL(resolve(cwd, input)).href
}

/**
 * A registry address, or undefined for anything that keeps its existing meaning.
 * `@scope/name` stays an npm package and a directory stays a directory, so the
 * npm and local paths of `dshx add` are untouched.
 */
const parseAddress = (spec: string, cwd: string): RegistryAddress | undefined => {
  if (/^https?:\/\//iu.test(spec)) return { kind: 'location', spec, url: spec }
  const path = spec.startsWith('file:') ? spec.slice('file:'.length) : spec
  if (path.endsWith('.json') && (spec.startsWith('file:') || path.startsWith('.') || isAbsolute(path)))
    return { kind: 'location', spec, url: toLocation(path, cwd) }
  const match = aliasAddressPattern.exec(spec)
  if (match?.[1] !== undefined && match[2] !== undefined && !RESERVED_ALIASES.has(match[1])) return { kind: 'alias', spec, alias: match[1], item: match[2] }
  return undefined
}

const isLoopback = (url: URL): boolean => LOOPBACK_HOSTS.has(url.hostname)

/** A document may reach only what its own origin could: a remote item never reads local files, and https never falls back to plain http. */
const assertReachable = (target: URL, from: URL | undefined): void => {
  const refuse = (reason: string): never => {
    throw new RegistryError(`Refusing ${target.href}: ${reason}.`, 'Serve registries over https, or use a local path while developing one.')
  }
  if (target.protocol === 'https:') return
  if (target.protocol === 'file:') {
    if (from !== undefined && from.protocol !== 'file:') refuse(`a remote document at ${from.href} cannot read local files`)
    return
  }
  if (target.protocol !== 'http:') refuse(`${target.protocol} is not a registry transport`)
  if (!isLoopback(target)) refuse('plain http is only allowed on loopback')
  if (from?.protocol === 'https:') refuse(`an https document at ${from.href} cannot downgrade to http`)
}

const readBounded = async (location: string, limit: number, from?: URL): Promise<Buffer> => {
  const url = new URL(location)
  assertReachable(url, from)
  const tooLarge = (): RegistryError =>
    new RegistryError(`${location} is larger than the ${String(limit / 1024 / 1024)} MiB limit.`, 'Keep registry documents and tarballs small.')
  if (url.protocol === 'file:') {
    const path = fileURLToPath(url)
    if (!existsSync(path)) throw new RegistryError(`${path} does not exist.`, 'Check the path, or run "dshx registry build" to produce it.')
    if ((await stat(path)).size > limit) throw tooLarge()
    return readFile(path)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch((cause: unknown) => {
    throw new RegistryError(`Could not reach ${location}: ${cause instanceof Error ? cause.message : String(cause)}.`, 'Check the URL and your connection.')
  })
  assertReachable(new URL(response.url), url)
  if (!response.ok)
    throw new RegistryError(`${location} answered HTTP ${String(response.status)}.`, 'Check the URL; the registry may have moved or dropped it.')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) throw tooLarge()
  return bytes
}

const decodeDocument = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, text: string, location: string): S['Type'] => {
  const fix = 'Rebuild it with "dshx registry build", or update dshx if the registry uses a newer format.'
  try {
    const decoded = decodeJsonSafe(schema, text)
    if (decoded._tag === 'Success') return decoded.success
    throw new RegistryError(`${location} is not a format ${String(REGISTRY_SCHEMA_VERSION)} registry document: ${decoded.failure.message}`, fix)
  } catch (error) {
    if (error instanceof RegistryError) throw error
    throw new RegistryError(`${location} is not valid JSON.`, fix)
  }
}

const readIndex = async (location: string): Promise<RegistryIndex> =>
  decodeDocument(registryIndexSchema, (await readBounded(location, MAX_DOCUMENT_BYTES)).toString('utf8'), location)

const readItem = async (location: string, address: string, from?: URL): Promise<LoadedItem> => ({
  item: decodeDocument(registryItemSchema, (await readBounded(location, MAX_DOCUMENT_BYTES, from)).toString('utf8'), location),
  itemUrl: location,
  address,
})

const aliasesPath = (dshHome: string): string => join(resolve(dshHome), ALIASES_FILE)

const readAliases = async (dshHome: string): Promise<Readonly<Record<string, string>>> => {
  const path = aliasesPath(dshHome)
  return existsSync(path) ? decodeJson(registryAliasesSchema, await readFile(path, 'utf8')).registries : {}
}

const writeAliases = async (dshHome: string, registries: Readonly<Record<string, string>>): Promise<void> => {
  await writeFileAtomic(aliasesPath(dshHome), `${JSON.stringify({ schemaVersion: REGISTRY_SCHEMA_VERSION, registries }, null, 2)}\n`)
}

const addAlias = async (dshHome: string, alias: string, location: string, cwd: string): Promise<{ readonly url: string; readonly index: RegistryIndex }> => {
  if (!aliasPattern.test(alias) || RESERVED_ALIASES.has(alias))
    throw new RegistryError(
      `"${alias}" cannot be a registry alias.`,
      `Use lowercase letters, digits and dashes, and none of: ${[...RESERVED_ALIASES].join(', ')}.`,
    )
  const url = toLocation(location, cwd)
  const index = await readIndex(url)
  await writeAliases(dshHome, { ...(await readAliases(dshHome)), [alias]: url })
  return { url, index }
}

const removeAlias = async (dshHome: string, alias: string): Promise<boolean> => {
  const { [alias]: removed, ...rest } = await readAliases(dshHome)
  if (removed === undefined) return false
  await writeAliases(dshHome, rest)
  return true
}

/** Fetch the item an address names. */
const load = async (address: RegistryAddress, dshHome: string): Promise<LoadedItem> => {
  if (address.kind === 'location') return readItem(address.url, address.spec)
  const registries = await readAliases(dshHome)
  const indexUrl = registries[address.alias]
  if (indexUrl === undefined) throw new RegistryError(`No registry is configured as "${address.alias}".`, `Run "dshx registry add ${address.alias} <url>".`)
  const index = await readIndex(indexUrl)
  const entry = index.items.find(candidate => candidate.name === address.item)
  if (entry === undefined) throw new RegistryError(`${index.name} has no item "${address.item}".`, `Run "dshx registry search --registry ${address.alias}".`)
  return readItem(new URL(entry.url, indexUrl).href, address.spec, new URL(indexUrl))
}

const dependencyLocation = (dependency: string, parent: LoadedItem): string => {
  if (/^https?:\/\//iu.test(dependency)) return dependency
  if (/^[a-z0-9][a-z0-9-]*$/u.test(dependency)) return new URL(`${dependency}.json`, parent.itemUrl).href
  throw new RegistryError(
    `${parent.item.name} declares the registry dependency "${dependency}", which is neither a sibling item name nor an absolute URL.`,
    'Fix the item. Local aliases mean nothing on another machine, so items cannot use them.',
  )
}

/**
 * The item and everything it needs, dependencies first, so a failure leaves
 * nothing half-wired. Copied source and built plugins install into different
 * places, so one graph holds only one type.
 */
const resolveGraph = async (
  root: LoadedItem,
  read: (location: string, from: URL) => Promise<LoadedItem> = (location, from) => readItem(location, location, from),
) => {
  const ordered: LoadedItem[] = []
  const done = new Set<string>()
  const visit = async (current: LoadedItem, path: readonly string[]): Promise<void> => {
    if (done.has(current.itemUrl)) return
    if (path.includes(current.itemUrl))
      throw new RegistryError(`Registry dependency cycle: ${[...path, current.itemUrl].join(' → ')}.`, 'Break the cycle in the registry items.')
    for (const dependency of current.item.registryDependencies) {
      const next = await read(dependencyLocation(dependency, current), new URL(current.itemUrl))
      if (next.item.type !== root.item.type)
        throw new RegistryError(
          `${current.item.name} (${current.item.type}) depends on ${next.item.name} (${next.item.type}).`,
          'Keep each dependency graph to one item type: a source copy and a built plugin install into different places.',
        )
      await visit(next, [...path, current.itemUrl])
    }
    done.add(current.itemUrl)
    ordered.push(current)
  }
  await visit(root, [])
  return ordered
}

const integrityOf = (bytes: Buffer): string => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/** Bytes that match the item's hash, read once: pnpm later installs this exact copy, never a second download. */
const readTarball = async (source: TarballSource, loaded: LoadedItem): Promise<Buffer> => {
  const location = new URL(source.url, loaded.itemUrl).href
  const bytes = await readBounded(location, MAX_TARBALL_BYTES, new URL(loaded.itemUrl))
  const actual = integrityOf(bytes)
  if (actual !== source.integrity)
    throw new RegistryError(
      `${location} does not match the integrity in ${loaded.itemUrl} (expected ${source.integrity}, got ${actual}).`,
      'Nothing was installed. Ask the registry owner to rebuild the item; do not bypass this check.',
    )
  return bytes
}

const tarballManifestSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  dsh: Schema.optional(Schema.Struct({ bundle: Schema.optional(jsonObjectSchema) })),
})

/** An item is a claim about a package; the package's own manifest is the fact. */
const assertTarballMatches = async (path: string, item: { readonly name: string; readonly package: string; readonly version: string }): Promise<void> => {
  const listing = await execa('tar', ['-xzOf', path, 'package/package.json'], { reject: false })
  const refuse = (reason: string): never => {
    throw new RegistryError(`The tarball of ${item.name} ${reason}.`, 'Nothing was installed. Rebuild the item with "dshx registry build".')
  }
  if (listing.exitCode !== 0) refuse('has no package/package.json (is it an npm pack tarball?)')
  const decoded = decodeJsonSafe(tarballManifestSchema, listing.stdout)
  if (decoded._tag !== 'Success') return refuse('has an unreadable package.json')
  const manifest = decoded.success
  if (manifest.name !== item.package || manifest.version !== item.version)
    refuse(`is ${manifest.name}@${manifest.version}, not the ${item.package}@${item.version} the item claims`)
  if (manifest.dsh?.bundle === undefined) refuse('declares no dsh.bundle, so DSH would install it as a plain dependency')
}

const dshVersionPattern = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u

const parseDshVersion = (output: string): string | undefined => dshVersionPattern.exec(output)?.[0]

/** `engines.dsh` against one DSH version. Prereleases count: DSH itself ships them. */
const enginesAllow = (range: string | undefined, version: string): boolean =>
  range === undefined || semver.satisfies(version, range, { includePrerelease: true })

export class RegistryClient {
  static readonly parseAddress = parseAddress
  static readonly toLocation = toLocation
  static readonly load = load
  static readonly readIndex = readIndex
  static readonly readAliases = readAliases
  static readonly addAlias = addAlias
  static readonly removeAlias = removeAlias
  static readonly resolveGraph = resolveGraph
  static readonly readTarball = readTarball
  static readonly assertTarballMatches = assertTarballMatches
  static readonly integrityOf = integrityOf
  static readonly parseDshVersion = parseDshVersion
  static readonly enginesAllow = enginesAllow
}
