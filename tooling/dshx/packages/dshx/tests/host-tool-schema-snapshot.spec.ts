import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from 'vitest'
import { createServer } from 'vite'
import { buildHost, type BuildHostOptions } from '../src/compiler/host/build.js'
import { resolveDshxConfig } from '../src/config/resolve.js'
import { createTestHost } from '../src/testing/index.js'

const expectedCounts = { hostBundles: 55, apiMethods: 471, apiToolBindings: 326, apiToolSchemas: 325, definedTools: 22, tools: 347 }
const fixturePath = new URL('../../../e2e/fixtures/tool-schemas.json', import.meta.url)

const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const getObjectProperty = (value: unknown, key: string) => (isObjectRecord(value) ? value[key] : undefined)

const getArrayProperty = (value: unknown, key: string): readonly unknown[] => {
  const result = getObjectProperty(value, key)
  if (result === undefined) return []
  if (!Array.isArray(result)) throw new Error(`Host definition field ${key} must be an array.`)
  return result
}

type JsonSnapshot = string | number | boolean | null | readonly JsonSnapshot[] | { readonly [key: string]: JsonSnapshot }

const canonicalize = (value: unknown): JsonSnapshot => {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isObjectRecord(value)) throw new Error('Host tool schema snapshot contains a non-JSON value.')
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  const canonical: Record<string, JsonSnapshot> = {}
  for (const [key, entry] of entries) canonical[key] = canonicalize(entry)
  return canonical
}

const toolProperty = (schemas: readonly unknown[], name: string, propertyName: string): Record<string, unknown> | undefined => {
  const tool = schemas.find(schema => isObjectRecord(schema) && schema.name === name)
  const parameters = getObjectProperty(tool, 'parameters')
  const properties = getObjectProperty(parameters, 'properties')
  const property = getObjectProperty(properties, propertyName)
  return isObjectRecord(property) ? property : undefined
}

const canonicalSnapshot = (source: string): string => `${JSON.stringify(canonicalize(JSON.parse(source)), null, 2)}\n`

const linkNodeModules = async (source: string, target: string) => {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceEntry = join(source, entry.name)
    const targetEntry = join(target, entry.name)
    if (entry.name.startsWith('@')) {
      await mkdir(targetEntry, { recursive: true })
      for (const packageEntry of await readdir(sourceEntry)) {
        const packageTarget = join(targetEntry, packageEntry)
        try {
          await lstat(packageTarget)
        } catch {
          await symlink(join(sourceEntry, packageEntry), packageTarget, 'dir')
        }
      }
      continue
    }
    try {
      await lstat(targetEntry)
    } catch {
      await symlink(sourceEntry, targetEntry, 'dir')
    }
  }
}

const workspaceAliases = async (pluginRoot: string, projects: readonly { readonly name: string }[]) => {
  const aliases: { readonly find: string; readonly replacement: string }[] = []
  for (const project of projects) {
    const root = join(pluginRoot, project.name)
    const manifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const name = getObjectProperty(manifest, 'name')
    if (typeof name !== 'string' || name === '@dshfiles/dshx') continue
    const exports = getObjectProperty(manifest, 'exports')
    if (typeof exports !== 'object' || exports === null) continue
    for (const [subpath, exportValue] of Object.entries(exports)) {
      const sourceTarget = getObjectProperty(exportValue, 'types')
      const defaultTarget = typeof exportValue === 'string' ? exportValue : getObjectProperty(exportValue, 'default')
      const candidates = [sourceTarget, defaultTarget].filter((target): target is string => typeof target === 'string')
      let targetPath: string | undefined
      for (const candidate of candidates) {
        const resolvedTarget = resolve(root, candidate)
        try {
          await lstat(resolvedTarget)
          targetPath = resolvedTarget
          break
        } catch {
          continue
        }
      }
      if (targetPath === undefined) continue
      aliases.push({ find: subpath === '.' ? name : `${name}${subpath.slice(1)}`, replacement: targetPath })
    }
  }
  return aliases.sort((left, right) => right.find.length - left.find.length)
}

const collectHostToolSchemas = async () => {
  const repositoryRoot = resolve(process.cwd(), '../../../..')
  const pluginRoot = join(repositoryRoot, 'plugins/@dshfiles')
  const projects = (await readdir(pluginRoot, { withFileTypes: true })).filter(entry => entry.isDirectory())
  // Match the native-fork and client-only exclusions recorded in the Effect plan.
  const excludedPackageIds = new Set([
    '@dshfiles/chat',
    '@dshfiles/rich-composer',
    '@dshfiles/session-controller',
    '@dshfiles/workspace-nav',
    '@dshfiles/subprocess-local',
    '@dshfiles/sidebar-right',
    '@dshfiles/user-questions',
    '@dshfiles/input-trigger',
    '@dshfiles/agent-preset',
    '@dshfiles/model-selection',
    '@dshfiles/frame-layout',
    '@dshfiles/goal-tool',
    '@dshfiles/hmr-gate',
  ])
  const scratchRoot = await mkdtemp(join(repositoryRoot, '.dshx-host-tool-schemas-'))
  const aliases = await workspaceAliases(pluginRoot, projects)
  const host = await createTestHost()
  await host.ctx.plugin(LocalSubprocessRuntime)
  await host.ctx.plugin(Storage)
  await host.ctx.plugin(StorageJson, { root: join(scratchRoot, '.storage') })
  await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  await host.ctx.plugin(LocalAttachmentStore, { dshHome: join(scratchRoot, '.home') })
  const viteServer = await createServer({
    root: repositoryRoot,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: aliases },
  })
  let hostBundles = 0
  const hostPackages: string[] = []
  let apiMethods = 0
  let apiToolBindings = 0
  const apiToolNames = new Set<string>()
  let definedTools = 0

  try {
    for (const project of projects) {
      const root = join(pluginRoot, project.name)
      const packageManifest: unknown = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
      const packageId = getObjectProperty(packageManifest, 'name')
      if (typeof packageId !== 'string' || excludedPackageIds.has(packageId)) continue
      if (!(await readdir(root)).includes('dshx.config.ts')) continue
      const resolved = await resolveDshxConfig({ cwd: root })
      if (resolved.hostEntry === undefined) continue
      hostBundles += 1
      hostPackages.push(resolved.packageId)
      const outputDir = join(scratchRoot, project.name)
      await mkdir(outputDir, { recursive: true })
      const outputNodeModules = join(outputDir, 'node_modules')
      await linkNodeModules(join(root, 'node_modules'), outputNodeModules)
      await linkNodeModules(join(repositoryRoot, 'node_modules'), outputNodeModules)
      const effectTarget = join(outputNodeModules, 'effect')
      try {
        await lstat(effectTarget)
      } catch {
        await symlink(resolve(process.cwd(), 'node_modules/effect'), effectTarget, 'dir')
      }
      const dshfilesScope = join(outputNodeModules, '@dshfiles')
      await mkdir(dshfilesScope, { recursive: true })
      for (const workspacePackage of projects) {
        const packageTarget = join(dshfilesScope, workspacePackage.name)
        try {
          await lstat(packageTarget)
        } catch {
          await symlink(join(pluginRoot, workspacePackage.name), packageTarget, 'dir')
        }
      }
      let buildOptions: BuildHostOptions = {
        packageId: resolved.packageId,
        logicalName: resolved.name,
        root: resolved.root,
        entry: relative(resolved.root, resolved.hostEntry),
        outDir: outputDir,
        sourcemap: false,
        declarations: false,
        bundleDependencies: Array.from(
          new Set([...(resolved.hostBundleDependencies ?? []), ...aliases.map(alias => alias.find.split('/').slice(0, 2).join('/'))]),
        ),
        schemaSnapshot: true,
        schemaSnapshotAliases: aliases,
      }
      if (resolved.hostVitePlugins !== undefined) buildOptions = { ...buildOptions, vite: { plugins: resolved.hostVitePlugins } }
      await buildHost(buildOptions)
      const builtModule = await viteServer.ssrLoadModule(join(outputDir, 'index.js'))
      const definition = builtModule.__dshxDefinition
      const tools = getArrayProperty(definition, 'tools')
      const apis = getArrayProperty(definition, 'apis')
      const bindingCounts = builtModule.__dshxApiBindingCounts
      if (!Array.isArray(bindingCounts)) throw new Error(`Missing API binding counts for ${resolved.packageId}.`)
      for (const bindingCount of bindingCounts) {
        const methodCount = getObjectProperty(bindingCount, 'methodCount')
        const toolMethodCount = getObjectProperty(bindingCount, 'toolMethodCount')
        if (typeof methodCount !== 'number' || typeof toolMethodCount !== 'number') throw new Error(`Invalid API binding counts for ${resolved.packageId}.`)
        const toolNames = getObjectProperty(bindingCount, 'toolNames')
        if (!Array.isArray(toolNames) || toolNames.some(name => typeof name !== 'string')) throw new Error(`Invalid API tool names for ${resolved.packageId}.`)
        apiMethods += methodCount
        apiToolBindings += toolMethodCount
        for (const toolName of toolNames) apiToolNames.add(toolName)
      }
      definedTools += tools.length
      if (tools.length === 0 && apis.length === 0) continue
      const plugin = builtModule.__dshxSchemaPlugin
      if (plugin === undefined) throw new Error(`Missing schema-only Host plugin export for ${resolved.packageId}.`)
      try {
        // Declarations never run setup: wait only for the injected services this Host provides, so a plugin that also
        // needs a session or web service still registers its tools and APIs.
        const inject = getArrayProperty(plugin, 'inject').filter(name => typeof name === 'string' && host.ctx.get(name) !== undefined)
        await host.ctx.plugin({ ...plugin, inject })
      } catch (error) {
        throw new Error(`Could not mount schema declarations from ${resolved.packageId}: ${String(error)}`)
      }
    }

    const schemas = host.tools.schemas()
    const apiToolSchemas = schemas.length - definedTools
    const tools = schemas
      .map(schema => {
        if (schema.description === undefined) return { name: schema.name, parameters: schema.parameters }
        return { name: schema.name, description: schema.description, parameters: schema.parameters }
      })
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    return Buffer.from(
      `${JSON.stringify({ hostBundles, hostPackages: hostPackages.sort(), apiMethods, apiToolBindings, apiToolNameCount: apiToolNames.size, apiToolSchemas, definedTools, tools: tools.length, schemas: tools }, null, 2)}\n`,
    )
  } finally {
    await viteServer.close()
    await host.dispose()
    await rm(scratchRoot, { recursive: true, force: true })
  }
}

describe('all Host tool schemas', () => {
  it('matches the recorded snapshot of every Host tool schema', async () => {
    const snapshot = await collectHostToolSchemas()
    if (process.env.UPDATE_HOST_TOOL_SCHEMA_SNAPSHOT === '1') {
      const outputPath = process.env.HOST_TOOL_SCHEMA_SNAPSHOT_PATH ?? fixturePath.pathname
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, snapshot)
      return
    }

    const snapshotText = snapshot.toString()
    const recorded: unknown = JSON.parse(snapshotText)
    expect(recorded).toMatchObject(expectedCounts)
    expect(canonicalSnapshot(snapshotText)).toBe(canonicalSnapshot(await readFile(fixturePath, 'utf8')))

    const schemas = getArrayProperty(recorded, 'schemas')
    expect(toolProperty(schemas, 'traces_alert_delete', 'confirm')).toMatchObject({ type: 'boolean', enum: [true] })
    expect(toolProperty(schemas, 'traces_alert_save', 'percentile')).toMatchObject({ type: 'number', enum: [50, 90, 95, 99] })
    expect(toolProperty(schemas, 'traces_clear', 'confirm')).toMatchObject({ type: 'boolean', enum: [true] })
    expect(toolProperty(schemas, 'traces_breakdown', 'groupBy')).toMatchObject({
      oneOf: [
        { properties: { kind: { enum: ['service'] } }, required: ['kind'] },
        { properties: { kind: { enum: ['operation'] } }, required: ['kind'] },
        { properties: { kind: { enum: ['attribute'] }, key: { type: 'string' } }, required: ['kind', 'key'] },
      ],
    })
  }, 300_000)
})
