import { createRequire } from 'node:module'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import type { Program } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import type { DshCompatibility } from '../compat/types.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { inspectProjectComposition } from '../inspect/provider.js'
import type { InspectOptions, InspectResult, SlotSummary } from '../inspect/types.js'
import { checkProjectManifest } from '../project/manifest.js'
import { CLIENT_AUTHORING_TOOLCHAIN, CLIENT_CAPABILITIES, CLIENT_SERVICES, DSH_PACKAGES } from 'create-dshx/capabilities'
import { ScaffoldFilePlan } from './common.js'

import { slotOwnerImports } from '../client/slot-reference.js'

export interface AddUiOptions {
  readonly project: ResolvedDshxConfig
  readonly slot?: string
  readonly provider?: string
  readonly file?: string
  readonly id?: string
  readonly order?: number
  readonly dryRun?: boolean
  readonly inspect?: InspectOptions
}

export interface ScaffoldFileSystem {
  readonly readFile: (file: string, encoding: 'utf8') => Promise<string>
  readonly writeFile: (file: string, data: string, encoding: 'utf8') => Promise<void>
  readonly mkdir: (file: string, options: { readonly recursive: true }) => Promise<unknown>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly unlink: (file: string) => Promise<void>
  readonly access: (file: string) => Promise<void>
  readonly writeFileAtomic?: (file: string, data: string) => Promise<void>
}

export interface AddUiDependencies {
  readonly fs?: Partial<ScaffoldFileSystem>
  readonly inspectComposition?: typeof inspectProjectComposition
  readonly checkManifest?: typeof checkProjectManifest
  readonly resolveProvider?: (projectRoot: string, provider: string) => Promise<boolean>
  readonly selectSlot?: (items: readonly SlotSummary[]) => Promise<string | undefined>
  readonly compatibility?: DshCompatibility
}

export interface AddUiResult {
  readonly root: string
  readonly slot: SlotSummary
  readonly provider: string
  readonly changedFiles: readonly string[]
  readonly generatedFiles: readonly string[]
  readonly manifestChanged: boolean
  readonly diagnostics: readonly DshxDiagnostic[]
  readonly diff?: string
}

interface PlannedFile {
  readonly file: string
  readonly before?: string
  readonly after: string
}

const defaultFs: ScaffoldFileSystem = { readFile, writeFile, mkdir, rename, unlink, access, writeFileAtomic: ScaffoldFilePlan.writeFileAtomically }

function diagnostic(code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic {
  return { code, severity, message, file, hint }
}

function mergeFs(input: Partial<ScaffoldFileSystem> | undefined): ScaffoldFileSystem {
  const merged = { ...defaultFs, ...(input ?? {}) }
  if (input?.writeFileAtomic === undefined && (input?.writeFile !== undefined || input?.rename !== undefined)) delete merged.writeFileAtomic
  return merged
}

function safeName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
  if (name === '') return 'GeneratedSlot'
  return /^[0-9]/.test(name) ? `Slot_${name}` : name
}

function safeFileName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return name === '' ? 'slot' : name
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && !path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep)
}

function defaultId(project: ResolvedDshxConfig, slot: string): string {
  return `${project.packageId}.${slot}`
}

function defaultComponentName(slot: string): string {
  return `${safeName(slot)}Slot`
}

function contributionIdentifier(slot: string): string {
  return `${safeName(slot)}Contribution`
}

function providerClient(provider: string): string {
  return `${provider}/client`
}

const nativeClientPackages: Set<string> = new Set([
  ...Object.values(CLIENT_SERVICES).map(service => service.packageName),
  ...Object.values(CLIENT_CAPABILITIES).flatMap(capability => capability.providers),
])

function clientPackageFromImport(value: string): string {
  return value.endsWith('/client') ? value.slice(0, -'/client'.length) : value
}

function slotClientPackages(slotName: string, provider: string): readonly string[] {
  const owners = slotOwnerImports(slotName).map(clientPackageFromImport)
  const ownerProviders = owners.flatMap(owner => {
    if (owner === DSH_PACKAGES.sidebar) return CLIENT_CAPABILITIES.sidebar.providers
    if (owner === DSH_PACKAGES.conversation) return CLIENT_CAPABILITIES.composer.providers
    return [owner]
  })
  return [...new Set([CLIENT_SERVICES.slots.packageName, ...ownerProviders, provider])]
}

interface SlotScaffoldContract {
  readonly kind: 'list' | 'single'
  readonly registration: readonly string[]
}

interface SlotContractResult {
  readonly contract?: SlotScaffoldContract
  readonly diagnostic?: DshxDiagnostic
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scaffoldContract(slot: SlotSummary, file: string, options: AddUiOptions): SlotContractResult {
  if (slot.type === 'factory') {
    return {
      diagnostic: diagnostic(
        'DSHX6110',
        `Factory ${JSON.stringify(slot.name)} is a composition container and does not accept UI contributions.`,
        file,
        'Choose a child Slot reported by dshx inspect slots.',
      ),
    }
  }
  if (slot.kind !== 'list' && slot.kind !== 'single') {
    return {
      diagnostic: diagnostic(
        'DSHX6110',
        `Slot ${JSON.stringify(slot.name)} uses unsupported ${JSON.stringify(slot.kind ?? 'unknown')} registration semantics.`,
        file,
        'Choose a list or single Slot, or register keyed/chain/select fields manually.',
      ),
    }
  }
  if (!isRecord(slot.metadata) || !isRecord(slot.metadata.catalog)) {
    return {
      diagnostic: diagnostic(
        'DSHX6111',
        `Slot ${JSON.stringify(slot.name)} has no stable exact contract metadata.`,
        file,
        'Run dshx inspect slots --root <slot-name> with a Client Inspect provider that exposes the full catalog.',
      ),
    }
  }
  const catalog = slot.metadata.catalog
  if (typeof catalog.replaceRisk !== 'string' || !Array.isArray(catalog.registration)) {
    return {
      diagnostic: diagnostic(
        'DSHX6111',
        `Slot ${JSON.stringify(slot.name)} has incomplete provider registration metadata.`,
        file,
        'Use an official Client Slot provider with catalog.registration and replaceRisk fields.',
      ),
    }
  }
  const registration: string[] = []
  for (const entry of catalog.registration) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== 'string' ||
      entry.name.trim() === '' ||
      typeof entry.required !== 'boolean' ||
      (entry.type !== undefined && typeof entry.type !== 'string')
    ) {
      return {
        diagnostic: diagnostic(
          'DSHX6111',
          `Slot ${JSON.stringify(slot.name)} has an invalid registration field descriptor.`,
          file,
          'Use the exact contract returned by the official Client Slot Inspect provider.',
        ),
      }
    }
    registration.push(entry.name)
    if (entry.required && !['id', 'order'].includes(entry.name)) {
      return {
        diagnostic: diagnostic(
          'DSHX6110',
          `Slot ${JSON.stringify(slot.name)} requires unsupported registration field ${JSON.stringify(entry.name)}.`,
          file,
          'Register this Slot manually using its official provider contract.',
        ),
      }
    }
  }
  if (slot.kind === 'list' && !registration.includes('id')) {
    return {
      diagnostic: diagnostic(
        'DSHX6111',
        `Slot ${JSON.stringify(slot.name)} does not declare a stable list id field.`,
        file,
        'Use an exact Slot contract that exposes the required id registration field.',
      ),
    }
  }
  if (options.order !== undefined && !registration.includes('order')) {
    return {
      diagnostic: diagnostic(
        'DSHX6110',
        `Slot ${JSON.stringify(slot.name)} does not accept an order registration field.`,
        file,
        'Omit --order or register this Slot manually with the official contract.',
      ),
    }
  }
  if (slot.kind === 'single' && (options.id !== undefined || options.order !== undefined)) {
    return {
      diagnostic: diagnostic(
        'DSHX6110',
        `Slot ${JSON.stringify(slot.name)} is single-valued and does not accept id/order options.`,
        file,
        'Omit --id and --order for a single Slot, or register it manually with the official contract.',
      ),
    }
  }
  return { contract: { kind: slot.kind, registration } }
}

async function defaultResolveProvider(projectRoot: string, provider: string): Promise<boolean> {
  try {
    const require = createRequire(resolve(projectRoot, 'package.json'))
    require.resolve(providerClient(provider))
    require.resolve('@deepseek-ai/dsh-client-ui-slots')
    return true
  } catch {
    return false
  }
}

function generatedSource(slot: SlotSummary, provider: string, id: string, order: number, registration: readonly string[]): string {
  const component = defaultComponentName(slot.name)
  const options = [
    ...(registration.includes('id') ? [`  id: ${JSON.stringify(id)},`] : []),
    ...(registration.includes('order') ? [`  order: ${order},`] : []),
  ].join('\n')
  return `import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'\nimport type {} from ${JSON.stringify(providerClient(provider))}\nimport { defineSlot } from '@dshfiles/dshx/client'\n\nexport function ${component}(_props: PropsRuntime<${JSON.stringify(slot.name)}>) {\n  return <button type="button">{${JSON.stringify(slot.name)}}</button>\n}\n\nexport const generatedSlot = defineSlot(${JSON.stringify(slot.name)}, {\n${options}${options === '' ? '' : '\n'}  component: ${component},\n})\n`
}

function relativeImport(fromFile: string, targetFile: string): string {
  let value = relative(dirname(fromFile), targetFile).replaceAll('\\', '/')
  if (!value.startsWith('.')) value = `./${value}`
  return value.replace(/\.(?:tsx?|jsx?)$/, '.js')
}

const hasSlotRegistration = (program: Program, slotName: string): boolean => {
  let found = false
  SourceSyntax.visit({
    program,
    visitor: {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineSlot') return
        const argument = node.arguments[0]
        if (argument !== undefined && argument.type !== 'SpreadElement' && SourceSyntax.stringValue(argument) === slotName) found = true
      },
    },
  })
  return found
}

interface ClientSlotEdit {
  readonly source: string | undefined
  readonly duplicate: boolean
}

function modifyClientSource(source: string, file: string, contributionFile: string, slotName: string): ClientSlotEdit {
  const sourceFile = SourceSyntax.parse({ file, source })
  if (hasSlotRegistration(sourceFile, slotName)) return { source: undefined, duplicate: true }
  const call = SourceSyntax.defaultCall({ program: sourceFile, name: 'defineClient' })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression')
    return { source: undefined, duplicate: false }
  const slots = SourceSyntax.objectProperty({ expression: argument, name: 'slots' })
  const slotProperty = argument.properties.find(property => property.type === 'Property' && SourceSyntax.propertyName(property.key) === 'slots')
  if (slotProperty !== undefined && (slots === undefined || slots.value.type !== 'ArrayExpression')) return { source: undefined, duplicate: false }
  const importPath = relativeImport(file, contributionFile)
  const identifier = contributionIdentifier(slotName)
  const importLine = `import { generatedSlot as ${identifier} } from ${JSON.stringify(importPath)}\n`
  const edits: Array<{ start: number; end: number; text: string }> = []
  const importEnd = SourceSyntax.lastImportEnd(sourceFile)
  edits.push({ start: importEnd, end: importEnd, text: `${importEnd === 0 ? '' : '\n'}${importLine}` })
  if (slots !== undefined && slots.value.type === 'ArrayExpression') {
    const array = slots.value
    const hasItems = array.elements.length > 0
    edits.push({ start: array.end - 1, end: array.end - 1, text: `${hasItems ? ', ' : ''}${identifier}` })
  } else {
    const openBrace = argument.start + source.slice(argument.start, argument.end).indexOf('{') + 1
    const hasProperties = argument.properties.length > 0
    edits.push({ start: openBrace, end: openBrace, text: `${hasProperties ? '\n' : ''}  slots: [${identifier}],${hasProperties ? '' : '\n'}` })
  }
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  return { source: result, duplicate: false }
}

function newClientSource(clientFile: string, contributionFile: string, slotName: string): string {
  const importPath = relativeImport(clientFile, contributionFile)
  const identifier = contributionIdentifier(slotName)
  // A slot's declaration lives in the package that owns it, so without a
  // type-only import of that owner the slot name does not typecheck here. The
  // reference is the same table `inspect slots --explain` prints.
  const owners = slotOwnerImports(slotName)
  const ownerImports = owners.map(owner => `import type {} from '${owner}'`).join('\n')
  return [
    `import { defineClient } from '@dshfiles/dshx/client'`,
    ownerImports,
    `import { generatedSlot as ${identifier} } from ${JSON.stringify(importPath)}`,
    '',
    'export default defineClient({',
    `  slots: [${identifier}],`,
    '})',
    '',
  ].join('\n')
}

function updateManifest(source: string, provider: string, slotName: string, compatibility: DshCompatibility) {
  const value = JSON.parse(source) as Record<string, unknown>
  const exports = value.exports
  if (exports !== undefined && (typeof exports !== 'object' || exports === null || Array.isArray(exports)))
    throw new Error('package.json exports must be an object when adding a Client entry.')
  const nextExports = (exports ?? {}) as Record<string, unknown>
  const existingClient = nextExports['./client']
  if (
    existingClient !== undefined &&
    existingClient !== './dist/client.js' &&
    !(
      typeof existingClient === 'object' &&
      existingClient !== null &&
      !Array.isArray(existingClient) &&
      (existingClient as Record<string, unknown>).default === './dist/client.js'
    )
  )
    throw new Error('package.json already declares an incompatible ./client export.')
  nextExports['./client'] = existingClient ?? './dist/client.js'
  value.exports = nextExports
  const dsh = typeof value.dsh === 'object' && value.dsh !== null && !Array.isArray(value.dsh) ? (value.dsh as Record<string, unknown>) : {}
  const client = typeof dsh.client === 'object' && dsh.client !== null && !Array.isArray(dsh.client) ? (dsh.client as Record<string, unknown>) : {}
  if (client.inject !== undefined && (!Array.isArray(client.inject) || !client.inject.every(item => typeof item === 'string'))) {
    throw new Error('dsh.client.inject must be an array of package names when adding a Client Slot.')
  }
  const requiredPackages = slotClientPackages(slotName, provider)
  const inject = [...new Set([...(Array.isArray(client.inject) ? client.inject : []), ...requiredPackages])]
  dsh.client = {
    ...client,
    platform: compatibility.client.manifest.platform,
    inject,
    external: Array.isArray(client.external) ? client.external : [],
    immediately: typeof client.immediately === 'boolean' ? client.immediately : false,
  }
  value.dsh = { ...dsh, client: dsh.client }

  const devDependencies = value.devDependencies === undefined ? {} : value.devDependencies
  const peerDependencies = value.peerDependencies === undefined ? {} : value.peerDependencies
  if (!isRecord(devDependencies) || !isRecord(peerDependencies)) throw new Error('package.json dependency fields must be objects when adding a Client Slot.')
  const nextDevDependencies = { ...devDependencies }
  const nextPeerDependencies = { ...peerDependencies }
  const addDependency = (dependencies: Record<string, unknown>, name: string, specifier: string): void => {
    const existing = dependencies[name]
    if (existing === undefined) dependencies[name] = specifier
    else if (typeof existing !== 'string' || existing.trim() === '')
      throw new Error(`package.json dependency ${JSON.stringify(name)} must be a non-empty version string.`)
  }
  const packageVersion = compatibility.verified.latest
  addDependency(nextDevDependencies, DSH_PACKAGES.slotContracts, packageVersion)
  addDependency(nextDevDependencies, 'react', CLIENT_AUTHORING_TOOLCHAIN.react)
  addDependency(nextDevDependencies, 'react-dom', CLIENT_AUTHORING_TOOLCHAIN.reactDom)
  addDependency(nextDevDependencies, '@types/react', CLIENT_AUTHORING_TOOLCHAIN.reactTypes)
  for (const name of requiredPackages) {
    if (!nativeClientPackages.has(name)) continue
    addDependency(nextDevDependencies, name, packageVersion)
    addDependency(nextPeerDependencies, name, compatibility.dshRange)
  }
  value.devDependencies = nextDevDependencies
  value.peerDependencies = nextPeerDependencies
  return { source: `${JSON.stringify(value, null, 2)}\n`, manifest: value }
}

async function readExisting(fs: ScaffoldFileSystem, file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

function result(
  project: ResolvedDshxConfig,
  slot: SlotSummary,
  provider: string,
  diagnostics: readonly DshxDiagnostic[],
  plan: readonly PlannedFile[],
  manifestChanged: boolean,
  diff?: string,
): AddUiResult {
  return {
    root: project.root,
    slot,
    provider,
    changedFiles: plan.map(item => item.file),
    generatedFiles: plan.filter(item => item.before === undefined).map(item => item.file),
    manifestChanged,
    diagnostics,
    ...(diff !== undefined && { diff }),
  }
}

/** Generate a Slot contribution and attach it to a DSHX-managed Client. */
export async function createUiScaffold(options: AddUiOptions, dependencies: AddUiDependencies = {}): Promise<AddUiResult> {
  const { project } = options
  const fs = mergeFs(dependencies.fs)
  const packageFile = project.packageFile
  let inspect: InspectResult
  try {
    inspect = await (dependencies.inspectComposition ?? inspectProjectComposition)(project, 'slots', options.inspect)
  } catch {
    const item = diagnostic(
      'DSHX6102',
      'Unable to inspect the running DSH composition.',
      packageFile,
      'Start a supported DSH Runtime Inspect Provider and retry.',
      'error',
    )
    return result(project, { name: options.slot ?? '' }, options.provider ?? '', [item], [], false)
  }
  if (inspect.diagnostics.some(item => item.severity === 'error')) {
    const mapped = inspect.diagnostics.map(item => (item.code === 'DSHX3201' ? diagnostic('DSHX6102', item.message, item.file, item.hint) : item))
    return result(project, { name: options.slot ?? '' }, options.provider ?? '', mapped, [], false)
  }
  const slots = inspect.items as readonly SlotSummary[]
  const contributionSlots = slots.filter(item => item.type !== 'factory')
  let slotName = options.slot
  if (slotName === undefined) slotName = await dependencies.selectSlot?.(contributionSlots)
  if (slotName === undefined || slotName.trim() === '') {
    const item = diagnostic(
      'DSHX6101',
      'A Slot name is required in non-interactive mode.',
      packageFile,
      'Pass --slot <slot-name>, or run in a TTY to choose a Slot interactively.',
    )
    return result(project, { name: '' }, options.provider ?? '', [item], [], false)
  }
  const treeSlot = slots.find(item => item.name === slotName)
  if (treeSlot === undefined) {
    const item = diagnostic(
      'DSHX6103',
      `Slot ${JSON.stringify(slotName)} was not returned by the Runtime Inspect Provider.`,
      packageFile,
      'Run dshx inspect slots and choose an available Slot name.',
    )
    return result(project, { name: slotName }, options.provider ?? '', [item], [], false)
  }
  if (treeSlot.type === 'factory') {
    const item = diagnostic(
      'DSHX6110',
      `Factory ${JSON.stringify(treeSlot.name)} is a composition container and does not accept UI contributions.`,
      packageFile,
      'Choose a child Slot reported by dshx inspect slots.',
    )
    return result(project, treeSlot, options.provider ?? treeSlot.provider ?? '', [item], [], false)
  }
  let exact: InspectResult
  try {
    exact = await (dependencies.inspectComposition ?? inspectProjectComposition)(project, 'slots', {
      ...(options.inspect ?? {}),
      slotRoot: treeSlot.name,
    })
  } catch {
    const item = diagnostic(
      'DSHX6102',
      'Unable to inspect the exact Slot contract from the running DSH composition.',
      packageFile,
      'Start a supported Client Slot Inspect Provider and retry.',
      'error',
    )
    return result(project, treeSlot, options.provider ?? treeSlot.provider ?? '', [item], [], false)
  }
  if (exact.diagnostics.some(item => item.severity === 'error')) {
    const mapped = exact.diagnostics.map(item =>
      item.code === 'DSHX3201' || item.code === 'DSHX3202' || item.code === 'DSHX3205'
        ? diagnostic('DSHX6102', item.message, item.file, item.hint)
        : item.code === 'DSHX3203'
          ? diagnostic('DSHX6111', item.message, item.file, item.hint)
          : item,
    )
    return result(project, treeSlot, options.provider ?? treeSlot.provider ?? '', mapped, [], false)
  }
  const exactSlot = (exact.items as readonly SlotSummary[]).find(item => item.name === treeSlot.name)
  if (exactSlot === undefined) {
    const item = diagnostic(
      'DSHX6111',
      `Exact contract for Slot ${JSON.stringify(treeSlot.name)} was not returned by the Client Inspect Provider.`,
      packageFile,
      'Run dshx inspect slots --root <slot-name> and retry after the Client provider is synchronized.',
    )
    return result(project, treeSlot, options.provider ?? treeSlot.provider ?? '', [item], [], false)
  }
  const exactContract = scaffoldContract(exactSlot, packageFile, options)
  if (exactContract.diagnostic !== undefined)
    return result(project, exactSlot, options.provider ?? exactSlot.provider ?? treeSlot.provider ?? '', [exactContract.diagnostic], [], false)
  const contract = exactContract.contract!
  const slot: SlotSummary = {
    ...treeSlot,
    ...exactSlot,
    ...(exactSlot.metadata !== undefined && { metadata: exactSlot.metadata }),
  }
  const provider = options.provider ?? slot.provider
  if (provider === undefined || provider.trim() === '') {
    const item = diagnostic(
      'DSHX6103',
      `Slot ${JSON.stringify(slot.name)} has no provider package metadata.`,
      packageFile,
      'Pass --provider <package> explicitly or use a provider that exposes package metadata.',
    )
    return result(project, slot, '', [item], [], false)
  }
  if (options.provider !== undefined && slot.provider !== undefined && options.provider !== slot.provider) {
    const item = diagnostic(
      'DSHX6103',
      `Provider ${JSON.stringify(options.provider)} does not match the inspected provider ${JSON.stringify(slot.provider)}.`,
      packageFile,
      'Use the provider reported by dshx inspect slots or inspect the desired Slot again.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  if (options.id !== undefined && options.id.trim() === '') {
    const item = diagnostic(
      'DSHX6101',
      'The Slot registration id must be a non-empty string.',
      packageFile,
      'Pass a non-empty value to --id or omit it to use the deterministic default.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  if (options.order !== undefined && !Number.isInteger(options.order)) {
    const item = diagnostic('DSHX6101', 'The Slot order must be an integer.', packageFile, 'Pass an integer value to --order or omit it to use 0.')
    return result(project, slot, provider, [item], [], false)
  }
  const nativeProvider = nativeClientPackages.has(provider)
  const providerExists = nativeProvider || (await (dependencies.resolveProvider ?? defaultResolveProvider)(project.root, provider))
  if (!providerExists) {
    const item = diagnostic(
      'DSHX6104',
      `Provider type entry ${JSON.stringify(providerClient(provider))} is not installed.`,
      packageFile,
      `Install ${provider} as a project devDependency, then run dshx add ui again.`,
    )
    return result(project, slot, provider, [item], [], false)
  }
  const clientFile = project.clientEntry ?? resolve(project.root, 'src/client.tsx')
  if (!inside(project.root, clientFile)) {
    const item = diagnostic(
      'DSHX6106',
      `Client output path must stay inside the project root: ${clientFile}.`,
      packageFile,
      'Choose a Client entry under the project root.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  const targetFile = resolve(project.root, options.file ?? `src/slots/${safeFileName(slot.name)}.tsx`)
  if (!inside(project.root, targetFile)) {
    const item = diagnostic(
      'DSHX6106',
      `Generated file must stay inside the project root: ${targetFile}.`,
      packageFile,
      'Use --file with a path under the project root.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  if (!targetFile.endsWith('.tsx')) {
    const item = diagnostic(
      'DSHX6106',
      `Generated Slot files must use a .tsx extension: ${targetFile}.`,
      targetFile,
      'Use --file with a .tsx path so the generated JSX can compile.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  const existingGenerated = await readExisting(fs, targetFile)
  if (existingGenerated !== undefined) {
    const generatedAst = SourceSyntax.parse({ file: targetFile, source: existingGenerated })
    if (hasSlotRegistration(generatedAst, slot.name)) {
      const item = diagnostic(
        'DSHX6109',
        `Slot ${JSON.stringify(slot.name)} is already generated in ${targetFile}.`,
        targetFile,
        'Keep the existing contribution; no new files were written.',
        'warning',
      )
      return result(project, slot, provider, [item], [], false)
    }
    const item = diagnostic(
      'DSHX6106',
      `Generated Slot file already exists: ${targetFile}.`,
      targetFile,
      'Choose another --file path or remove the existing file after reviewing it.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  const clientBefore = await readExisting(fs, clientFile)
  const packageBefore = await readExisting(fs, packageFile)
  if (packageBefore === undefined) {
    const item = diagnostic('DSHX6107', `Cannot read project manifest: ${packageFile}.`, packageFile, 'Fix the project manifest permissions and retry.')
    return result(project, slot, provider, [item], [], false)
  }
  let clientAfter: string
  let manifestAfter: string | undefined
  let manifest: Record<string, unknown> = project.manifest as Record<string, unknown>
  let manifestChanged = false
  if (clientBefore === undefined) {
    clientAfter = newClientSource(clientFile, targetFile, slot.name)
  } else {
    const modified = modifyClientSource(clientBefore, clientFile, targetFile, slot.name)
    if (modified.duplicate) {
      const item = diagnostic(
        'DSHX6109',
        `Slot ${JSON.stringify(slot.name)} is already registered in ${clientFile}.`,
        clientFile,
        'Keep the existing contribution; no new files were written.',
        'warning',
      )
      return result(project, slot, provider, [item], [], false)
    }
    if (modified.source === undefined) {
      const item = diagnostic(
        'DSHX6105',
        `Client ${clientFile} is not a DSHX defineClient default export.`,
        clientFile,
        'Export defineClient({ slots: [...] }) or attach the Slot manually in native Client code.',
      )
      return result(project, slot, provider, [item], [], false)
    }
    clientAfter = modified.source
  }
  try {
    const updated = updateManifest(packageBefore, provider, slot.name, dependencies.compatibility ?? DEFAULT_COMPATIBILITY)
    manifestAfter = updated.source
    manifest = updated.manifest
    manifestChanged = manifestAfter !== packageBefore
  } catch (cause) {
    const item = diagnostic(
      'DSHX6107',
      `Cannot update project manifest: ${cause instanceof Error ? cause.message : String(cause)}`,
      packageFile,
      'Fix package.json exports, dependency fields, and DSH metadata before generating a Client.',
    )
    return result(project, slot, provider, [item], [], false)
  }
  const plan: PlannedFile[] = [
    { file: targetFile, after: generatedSource(slot, provider, options.id ?? defaultId(project, slot.name), options.order ?? 0, contract.registration) },
    ...(clientBefore === undefined ? [{ file: clientFile, after: clientAfter }] : [{ file: clientFile, before: clientBefore, after: clientAfter }]),
    ...(manifestAfter === undefined || manifestAfter === packageBefore ? [] : [{ file: packageFile, before: packageBefore, after: manifestAfter }]),
  ]
  if (options.dryRun) return result(project, slot, provider, [], plan, manifestChanged, ScaffoldFilePlan.renderFileDiff(plan))
  try {
    await ScaffoldFilePlan.applyFilePlanWithFileSystem(plan, fs)
  } catch (cause) {
    const item = diagnostic(
      'DSHX6107',
      `Failed to write Slot scaffold: ${cause instanceof Error ? cause.message : String(cause)}`,
      targetFile,
      'Fix filesystem permissions and retry; no partial changes were kept.',
    )
    return result(project, slot, provider, [item], [], manifestChanged)
  }
  const postProject: ResolvedDshxConfig = {
    ...project,
    ...(clientBefore === undefined && { clientEntry: clientFile }),
    manifest,
  }
  const compatibility = dependencies.compatibility ?? inspect.dsh?.compatibility ?? DEFAULT_COMPATIBILITY
  let postDiagnostics: readonly DshxDiagnostic[]
  try {
    postDiagnostics = await (dependencies.checkManifest ?? checkProjectManifest)(postProject, { compatibility })
  } catch (cause) {
    await ScaffoldFilePlan.rollbackFilePlanWithFileSystem(plan, fs)
    const item = diagnostic(
      'DSHX6108',
      `Generated Slot scaffold could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
      packageFile,
      'Fix the project manifest or compatibility adapter before generating a Slot.',
    )
    return result(project, slot, provider, [item], [], manifestChanged)
  }
  if (postDiagnostics.some(item => item.severity === 'error')) {
    await ScaffoldFilePlan.rollbackFilePlanWithFileSystem(plan, fs)
    const item = diagnostic(
      'DSHX6108',
      'Generated Slot scaffold failed Manifest Checker validation and was rolled back.',
      packageFile,
      'Fix the project manifest or compatibility adapter before generating a Slot.',
    )
    return result(project, slot, provider, [item, ...postDiagnostics], [], manifestChanged)
  }
  return result(project, slot, provider, postDiagnostics, plan, manifestChanged)
}
