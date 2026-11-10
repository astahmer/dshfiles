import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as Schema from 'effect/Schema'
import writeFileAtomic from 'write-file-atomic'
import { declaredDshRange } from '../compat/index.js'
import { decodeJson, jsonObjectSchema } from '../json.js'
import { previewPublish } from '../toolchain/index.js'
import { RegistryClient, type LoadedItem } from './client.js'
import {
  REGISTRY_SCHEMA_VERSION,
  RegistryError,
  itemNameForPackage,
  registryBuildSchema,
  type PluginItem,
  type RegistryBuildSource,
  type RegistryIndexEntry,
  type RegistryItem,
  type SourceItem,
} from './format.js'
import { SourceItems } from './source-items.js'

export interface RegistryBuildResult {
  readonly name: string
  readonly out: string
  readonly items: readonly { readonly name: string; readonly type: string; readonly version: string; readonly file: string }[]
  readonly warnings: readonly string[]
}

const packageManifestSchema = Schema.StructWithRest(
  Schema.Struct({
    name: Schema.String,
    version: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    license: Schema.optional(Schema.String),
    homepage: Schema.optional(Schema.String),
    author: Schema.optional(Schema.Unknown),
    main: Schema.optional(Schema.String),
    engines: Schema.optional(Schema.Struct({ dsh: Schema.optional(Schema.String) })),
    dsh: Schema.optional(Schema.Struct({ bundle: Schema.optional(Schema.Struct({ patch: Schema.optional(Schema.String) })) })),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

/** Optional document fields stay absent rather than `undefined`, which `exactOptionalPropertyTypes` tells apart. */
const definedFields = <T extends object>(value: T): T =>
  // SAFETY: only keys whose value is undefined are dropped, so every remaining key keeps its type from T.
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T

type BuildPlugin = Extract<RegistryBuildSource['items'][number], { readonly type: 'dsh:plugin' }>
type BuildSource = Extract<RegistryBuildSource['items'][number], { readonly type: 'dsh:source' }>

/** npm packs the package exactly as an npm release; the tarball route only changes who hosts the bytes. */
const packTarball = async (root: string, destination: string): Promise<string> => {
  await mkdir(destination, { recursive: true })
  const packed = await execa('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', destination], { cwd: root, reject: false })
  const filename = packed.stdout.trim().split('\n').at(-1)
  if (packed.exitCode !== 0 || filename === undefined || filename === '')
    throw new RegistryError(`npm could not pack ${root}: ${packed.stderr}`, 'Fix the reported npm problem, then rebuild.')
  return join(destination, filename)
}

const buildPlugin = async (entry: BuildPlugin, base: string, out: string, warnings: string[]): Promise<PluginItem> => {
  const root = resolve(base, entry.path)
  if (!existsSync(join(root, 'package.json'))) throw new RegistryError(`${root} has no package.json.`, 'Point "path" at a plugin package directory.')
  const text = await readFile(join(root, 'package.json'), 'utf8')
  const manifest = decodeJson(packageManifestSchema, text)
  if (manifest.dsh?.bundle === undefined)
    throw new RegistryError(`${manifest.name} declares no dsh.bundle.`, 'Add "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } to its package.json.')
  const required = [manifest.main ?? 'dist/index.js', manifest.dsh.bundle.patch ?? 'cordis.patch.yml']
  const rawManifest = decodeJson(jsonObjectSchema, text)
  const preview = await previewPublish(root, rawManifest, required)
  // A private package is fine outside npm, but no tarball install can resolve workspace: or catalog: specifiers.
  const blocking = preview.diagnostics.filter(item =>
    entry.distribution === 'tarball' ? item.code !== 'DSHX6405' && (item.severity === 'error' || item.code === 'DSHX6407') : item.severity === 'error',
  )
  if (blocking[0] !== undefined) throw new RegistryError(`${manifest.name}: ${blocking[0].message}`, blocking[0].hint ?? 'Fix the package, then rebuild.')
  warnings.push(...preview.diagnostics.filter(item => item.severity === 'warning' && !blocking.includes(item)).map(item => `${manifest.name}: ${item.message}`))
  const version = manifest.version
  if (version === undefined) throw new RegistryError(`${manifest.name} has no version.`, 'Set "version" in its package.json.')

  const name = entry.name ?? itemNameForPackage(manifest.name)
  const dsh = manifest.engines?.dsh ?? declaredDshRange(rawManifest)
  if (dsh === undefined) warnings.push(`${manifest.name} declares no DSH range, so its item claims every DSH version.`)
  const common = definedFields({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    name,
    type: 'dsh:plugin' as const,
    version,
    title: entry.title,
    description: manifest.description,
    author: entry.author,
    license: manifest.license,
    homepage: manifest.homepage,
    engines: dsh === undefined ? {} : { dsh },
    registryDependencies: entry.registryDependencies,
    package: manifest.name,
  })
  if (entry.distribution === 'npm') return { ...common, source: definedFields({ type: 'npm' as const, registry: entry.npmRegistry }) }
  const packed = await packTarball(root, join(out, 'tarballs'))
  const target = join(out, 'tarballs', `${name}-${version}.tgz`)
  await rename(packed, target)
  return { ...common, source: { type: 'tarball', url: `../tarballs/${name}-${version}.tgz`, integrity: RegistryClient.integrityOf(await readFile(target)) } }
}

const buildSource = async (entry: BuildSource, base: string): Promise<SourceItem> => {
  const files = await Promise.all(
    entry.files.map(async file => {
      SourceItems.assertTarget(file.target)
      const path = resolve(base, file.path)
      if (!existsSync(path)) throw new RegistryError(`${entry.name}: ${path} does not exist.`, 'Fix the "path" in dshx.registry.json.')
      return { target: file.target, content: await readFile(path, 'utf8') }
    }),
  )
  return { ...entry, schemaVersion: REGISTRY_SCHEMA_VERSION, files }
}

/** Author-time check of the same rules an install applies, against the items just built. */
const assertGraph = async (items: readonly RegistryItem[], out: string): Promise<void> => {
  const byLocation = new Map(items.map(item => [pathToFileURL(join(out, 'r', `${item.name}.json`)).href, item]))
  const asLoaded = (location: string, item: RegistryItem): LoadedItem => ({ item, itemUrl: location, address: location })
  const read = async (location: string): Promise<LoadedItem> => {
    const item = byLocation.get(location)
    if (item === undefined)
      throw new RegistryError(`A registry dependency points at ${location}, which this registry does not build.`, 'Add that item, or use an absolute URL.')
    return asLoaded(location, item)
  }
  for (const [location, item] of byLocation) {
    if (item.registryDependencies.every(dependency => !/^https?:\/\//iu.test(dependency))) await RegistryClient.resolveGraph(asLoaded(location, item), read)
  }
}

/** Turn `dshx.registry.json` into static documents; anything that serves files can host the result. */
const build = async (sourceFile: string, outDirectory: string): Promise<RegistryBuildResult> => {
  if (!existsSync(sourceFile))
    throw new RegistryError(`${sourceFile} does not exist.`, 'Write a dshx.registry.json (see docs/registry.md), or pass --source <file>.')
  const source = decodeJson(registryBuildSchema, await readFile(sourceFile, 'utf8'))
  const base = dirname(resolve(sourceFile))
  const out = resolve(outDirectory)
  if (out === base) throw new RegistryError(`--out ${out} is the source directory.`, 'Choose a dedicated output directory such as ./public/registry.')
  const warnings: string[] = []
  const items: RegistryItem[] = []
  for (const entry of source.items) items.push(entry.type === 'dsh:plugin' ? await buildPlugin(entry, base, out, warnings) : await buildSource(entry, base))
  const duplicate = items.find((item, index) => items.findIndex(other => other.name === item.name) !== index)
  if (duplicate !== undefined) throw new RegistryError(`Two items are named ${duplicate.name}.`, 'Give one of them another "name".')
  await assertGraph(items, out)

  await mkdir(join(out, 'r'), { recursive: true })
  const indexItems: RegistryIndexEntry[] = []
  for (const item of items) {
    const url = `r/${item.name}.json`
    await writeFileAtomic(join(out, url), `${JSON.stringify(item, null, 2)}\n`)
    indexItems.push(
      definedFields({ name: item.name, type: item.type, version: item.version, title: item.title, description: item.description, engines: item.engines, url }),
    )
  }
  const index = definedFields({ schemaVersion: REGISTRY_SCHEMA_VERSION, name: source.name, homepage: source.homepage, items: indexItems })
  await writeFileAtomic(join(out, 'registry.json'), `${JSON.stringify(index, null, 2)}\n`)
  return {
    name: source.name,
    out,
    items: items.map(item => ({ name: item.name, type: item.type, version: item.version, file: relative(out, join(out, 'r', `${item.name}.json`)) })),
    warnings,
  }
}

export class RegistryBuilder {
  static readonly build = build
}
