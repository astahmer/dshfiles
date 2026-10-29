import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { ArrayExpression, Expression, ObjectExpression, Program } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import { jsonObjectSchema } from '../json.js'
import { CLIENT_CAPABILITIES, DSH_PROTOCOL_2, HOST_CAPABILITIES, SDK_RUNTIME_DEPENDENCIES } from 'create-dshx/capabilities'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import type { DshCompatibility } from '../compat/types.js'
import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import { checkProjectManifest } from '../project/manifest.js'
import { ScaffoldFilePlan } from './common.js'
import { ScaffoldPresets } from './presets.js'

export type AddPresetName = 'panel' | 'api'

export interface AddPresetOptions {
  readonly project: ResolvedDshxConfig
  readonly preset: AddPresetName
  /** Panel id or API slug; format is validated by the CLI. */
  readonly id: string
  /** Panel title for sidebar navigation; defaults to the panel id. */
  readonly title?: string
  readonly dryRun?: boolean
  readonly compatibility?: DshCompatibility
}

export interface ScaffoldFileSystem {
  readonly readFile: (file: string, encoding: 'utf8') => Promise<string>
  readonly writeFile: (file: string, data: string, encoding: 'utf8') => Promise<void>
  readonly mkdir: (file: string, options: { readonly recursive: true }) => Promise<unknown>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly unlink: (file: string) => Promise<void>
  readonly writeFileAtomic?: (file: string, data: string) => Promise<void>
}

export interface AddPresetDependencies {
  readonly fs?: Partial<ScaffoldFileSystem>
  readonly checkManifest?: typeof checkProjectManifest
}

export interface AddPresetResult {
  readonly root: string
  readonly preset: AddPresetName
  readonly id: string
  readonly changedFiles: readonly string[]
  readonly generatedFiles: readonly string[]
  readonly diagnostics: readonly DshxDiagnostic[]
  readonly diff?: string
}

interface PlannedFile {
  readonly file: string
  readonly before?: string
  readonly after: string
}

const defaultFs: ScaffoldFileSystem = {
  readFile,
  writeFile: (file, data, encoding) => writeFile(file, data, encoding),
  mkdir,
  rename,
  unlink,
  writeFileAtomic: ScaffoldFilePlan.writeFileAtomically,
}

const mergeFs = (input: Partial<ScaffoldFileSystem> | undefined): ScaffoldFileSystem => ({ ...defaultFs, ...input })

const diagnostic = (code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic => ({
  code,
  severity,
  message,
  file,
  hint,
})

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const parseManifest = (source: string): Record<string, unknown> | undefined => {
  try {
    return record(JSON.parse(source))
  } catch {
    return undefined
  }
}

const copyRecord = (value: unknown) => ({ ...(record(value) ?? {}) })

const updateManifestForPreset = (manifest: Record<string, unknown>, preset: AddPresetName, clientRpc: boolean): Record<string, unknown> | undefined => {
  const updated = { ...manifest }
  if (
    (updated.exports !== undefined && record(updated.exports) === undefined) ||
    (updated.devDependencies !== undefined && record(updated.devDependencies) === undefined) ||
    (updated.peerDependencies !== undefined && record(updated.peerDependencies) === undefined) ||
    (updated.dsh !== undefined && record(updated.dsh) === undefined)
  )
    return undefined
  const developmentDependencies = copyRecord(updated.devDependencies)
  const peerDependencies = copyRecord(updated.peerDependencies)
  const dshVersion = developmentDependencies['@deepseek-ai/dsh'] ?? DSH_PROTOCOL_2.version
  const dshRange = peerDependencies['@deepseek-ai/dsh'] ?? DSH_PROTOCOL_2.range
  peerDependencies['@deepseek-ai/dsh'] ??= DSH_PROTOCOL_2.range
  const providers =
    preset === 'api' ? HOST_CAPABILITIES.rpc.providers : [...CLIENT_CAPABILITIES.panels.providers, ...(clientRpc ? CLIENT_CAPABILITIES.rpc.providers : [])]
  for (const provider of providers) {
    developmentDependencies[provider] ??= dshVersion
    peerDependencies[provider] ??= dshRange
  }

  if (preset === 'api') {
    if (updated.dependencies !== undefined && record(updated.dependencies) === undefined) return undefined
    const dependencies = copyRecord(updated.dependencies)
    dependencies.zod ??= SDK_RUNTIME_DEPENDENCIES.zod
    updated.dependencies = dependencies
  }

  if (preset === 'panel' || clientRpc) {
    const exports = copyRecord(updated.exports)
    if (!Object.hasOwn(exports, './client')) {
      const rootExport = exports['.']
      exports['./client'] = record(rootExport) === undefined ? './dist/client.js' : { types: './dist/client.d.ts', default: './dist/client.js' }
    }
    const dsh = copyRecord(updated.dsh)
    const existingClient = dsh.client
    if (existingClient !== undefined && record(existingClient) === undefined) return undefined
    const client = copyRecord(existingClient)
    const existingInject = client.inject
    if (existingInject !== undefined && (!Array.isArray(existingInject) || existingInject.some(item => typeof item !== 'string'))) return undefined
    const inject = Array.isArray(existingInject) ? [...existingInject] : []
    const clientProviders = [...(preset === 'panel' ? CLIENT_CAPABILITIES.panels.providers : []), ...(clientRpc ? CLIENT_CAPABILITIES.rpc.providers : [])]
    for (const provider of clientProviders) if (!inject.includes(provider)) inject.push(provider)
    client.platform ??= 'web'
    client.inject = inject
    client.external ??= []
    client.immediately ??= false
    dsh.client = client
    updated.dsh = dsh
    updated.exports = exports
  }

  if (preset === 'panel') {
    developmentDependencies.react ??= '^18.3.1'
    developmentDependencies['react-dom'] ??= '^18.3.1'
    developmentDependencies['@types/react'] ??= '~18.3.31'
    developmentDependencies['@deepseek-ai/dsh-client-ui-slots'] ??= dshVersion
  }
  updated.devDependencies = developmentDependencies
  updated.peerDependencies = peerDependencies
  return updated
}

const readExisting = async (fs: ScaffoldFileSystem, file: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return undefined
  }
}

const inside = (root: string, target: string): boolean => {
  const check = resolve(root, target)
  return check === root || check.startsWith(`${root}/`)
}

const toFilePlan = (file: PlannedFile) => ({
  file: file.file,
  ...(file.before !== undefined && { before: file.before }),
  after: file.after,
})

const parse = (source: string, file: string): Program | undefined => {
  try {
    return SourceSyntax.parse({ file, source })
  } catch {
    return undefined
  }
}

const defaultDefinition = (program: Program, name: 'defineClientPlugin' | 'definePlugin'): ObjectExpression | undefined => {
  const call = SourceSyntax.defaultCall({ program, name })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression') return undefined
  return argument
}
/** The setup body's brace position, when setup is a literal function with a block body. */
const setupBodyOpenBrace = (propertyValue: Expression): { open: number; close: number } | undefined => {
  const value = SourceSyntax.unwrapExpression(propertyValue)
  if (value.type !== 'ArrowFunctionExpression' && value.type !== 'FunctionExpression') return undefined
  const body = value.body
  if (body === null || body.type !== 'BlockStatement') return undefined
  return { open: body.start + 1, close: body.end - 1 }
}

/** A relative specifier with the .js extension NodeNext resolution requires. */
const relativeImport = (fromFile: string, targetFile: string): string => {
  const spec = relative(dirname(fromFile), targetFile.replace(/\.(tsx|ts|jsx|mts|cts)$/, '.js'))
  return spec.startsWith('.') ? spec : `./${spec}`
}

const applyEdits = (source: string, edits: readonly { readonly start: number; readonly end: number; readonly text: string }[]): string =>
  [...edits].sort((left, right) => right.start - left.start).reduce((text, edit) => `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`, source)

const addArrayElement = (edits: { start: number; end: number; text: string }[], array: ArrayExpression, text: string): void => {
  if (array.elements.length === 0) {
    edits.push({ start: array.start + 1, end: array.end - 1, text })
    return
  }
  const last = array.elements.at(-1)
  if (last === null || last === undefined) return
  edits.push({ start: last.end, end: last.end, text: `, ${text}` })
}

const insertObjectProperty = (edits: { start: number; end: number; text: string }[], source: string, object: ObjectExpression, text: string): void => {
  const openBrace = object.start + source.slice(object.start, object.end).indexOf('{') + 1
  const hasProperties = object.properties.length > 0
  edits.push({ start: openBrace, end: openBrace, text: `${hasProperties ? '\n' : ''}${text}${hasProperties ? '' : '\n'}` })
}

/** Create the preset's new files and wire the contribution into the existing entries. */
export async function createPresetScaffold(options: AddPresetOptions, dependencies: AddPresetDependencies = {}): Promise<AddPresetResult> {
  const fs = mergeFs(dependencies.fs)
  const { project, preset, id } = options
  const symbols = ScaffoldPresets.symbols({ preset, id, packageId: project.packageId })
  const plan: PlannedFile[] = []
  const diagnostics: DshxDiagnostic[] = []
  const finish = (diff?: string): AddPresetResult => ({
    root: project.root,
    preset,
    id,
    changedFiles: plan.map(item => item.file),
    generatedFiles: plan.filter(item => item.before === undefined).map(item => item.file),
    diagnostics,
    ...(diff !== undefined && { diff }),
  })
  const refuse = async (item: DshxDiagnostic): Promise<AddPresetResult> => {
    diagnostics.push(item)
    return finish()
  }

  /**
   * Existing files first: an existing generated file means the preset ran
   * before, so nothing else may change — no second contract, no wiring edits.
   */
  for (const file of ScaffoldPresets.files({ preset, id, packageId: project.packageId })) {
    const absolute = resolve(project.root, file.path)
    if ((await readExisting(fs, absolute)) !== undefined) {
      return refuse(diagnostic('DSHX6302', `${absolute} already exists.`, absolute, 'Remove it or choose another id; the preset refuses to overwrite.'))
    }
  }

  const packageBefore = await readExisting(fs, project.packageFile)
  const packageManifest = packageBefore === undefined ? undefined : parseManifest(packageBefore)
  if (packageBefore === undefined || packageManifest === undefined) {
    return refuse(
      diagnostic(
        'DSHX6307',
        `The package manifest ${project.packageFile} is missing or invalid JSON.`,
        project.packageFile,
        'Fix package.json before adding a preset.',
      ),
    )
  }
  let clientRpc = preset === 'api' && project.clientEntry !== undefined
  if (preset === 'panel' && project.hostEntry !== undefined) {
    const hostSource = await readExisting(fs, project.hostEntry)
    const hostProgram = hostSource === undefined ? undefined : parse(hostSource, project.hostEntry)
    const hostObject = hostProgram === undefined ? undefined : defaultDefinition(hostProgram, 'definePlugin')
    clientRpc = hostObject !== undefined && SourceSyntax.objectProperty({ expression: hostObject, name: 'apis' }) !== undefined
  }
  const updatedManifest = updateManifestForPreset(packageManifest, preset, clientRpc)
  if (updatedManifest === undefined) {
    return refuse(
      diagnostic(
        'DSHX6306',
        `The package manifest ${project.packageFile} has an unsupported field shape for the ${preset} preset.`,
        project.packageFile,
        'Keep exports, dependencies, peerDependencies, and DSH Client injection as literal objects and arrays.',
      ),
    )
  }
  const packageAfter = `${JSON.stringify(updatedManifest, null, 2)}\n`
  const packageChanged = JSON.stringify(packageManifest) !== JSON.stringify(updatedManifest)
  let clientEntryForCheck = project.clientEntry

  /**
   * The wiring target is checked before anything is staged: a refused preset
   * leaves zero writes, whether the refusal came from a missing entry, a file
   * that does not parse, or a registration that already exists.
   */
  if (preset === 'panel') {
    if (project.clientEntry === undefined || !inside(project.root, project.clientEntry)) {
      const clientEntry = resolve(project.root, 'src/client.tsx')
      const clientBefore = await readExisting(fs, clientEntry)
      if (clientBefore !== undefined) {
        return refuse(
          diagnostic(
            'DSHX6302',
            `${clientEntry} already exists but is not configured as the Client entry.`,
            clientEntry,
            'Wire the existing entry in dshx.config.ts before adding a panel.',
          ),
        )
      }
      const configFile = project.configFile
      const configBefore = configFile === undefined || !inside(project.root, configFile) ? undefined : await readExisting(fs, configFile)
      if (configFile === undefined || configBefore === undefined) {
        return refuse(
          diagnostic(
            'DSHX6301',
            'A literal dshx.config.ts is required to create a Client entry.',
            project.packageFile,
            'Add a static defineConfig({ host, ... }) export and retry.',
          ),
        )
      }
      const configProgram = parse(configBefore, configFile)
      const configCall = configProgram === undefined ? undefined : SourceSyntax.defaultCall({ program: configProgram, name: 'defineConfig' })
      const configArgument = configCall?.arguments[0]
      if (
        configCall === undefined ||
        configCall.arguments.length !== 1 ||
        configArgument === undefined ||
        configArgument.type !== 'ObjectExpression' ||
        configArgument.properties.some(property => property.type === 'SpreadElement')
      ) {
        return refuse(
          diagnostic(
            'DSHX6305',
            `The config in ${configFile} is not a static defineConfig object.`,
            configFile,
            'Export defineConfig({ host: { entry: ... } }) without spreads or dynamic values.',
          ),
        )
      }
      if (SourceSyntax.objectProperty({ expression: configArgument, name: 'client' }) !== undefined) {
        return refuse(
          diagnostic(
            'DSHX6301',
            'The Client entry is explicitly disabled or could not be resolved.',
            configFile,
            'Set client: { entry: "src/client.tsx" } and retry.',
          ),
        )
      }
      const configEdits: { start: number; end: number; text: string }[] = []
      insertObjectProperty(configEdits, configBefore, configArgument, "  client: { entry: 'src/client.tsx' },")
      plan.push({ file: configFile, before: configBefore, after: applyEdits(configBefore, configEdits) })
      plan.push({
        file: clientEntry,
        after: ScaffoldPresets.panelClientEntry({ preset, id, packageId: project.packageId, ...(options.title !== undefined && { title: options.title }) }),
      })
      clientEntryForCheck = clientEntry
    } else {
      const clientBefore = await readExisting(fs, project.clientEntry)
      if (clientBefore === undefined) {
        return refuse(
          diagnostic(
            'DSHX6301',
            `The Client entry ${project.clientEntry} does not exist.`,
            project.packageFile,
            'Create the configured Client entry and run dshx add panel again.',
          ),
        )
      }
      const program = parse(clientBefore, project.clientEntry)
      if (program === undefined) {
        return refuse(
          diagnostic('DSHX6307', `The Client entry ${project.clientEntry} does not parse.`, project.clientEntry, 'Fix the entry source before adding a panel.'),
        )
      }
      const object = defaultDefinition(program, 'defineClientPlugin')
      if (object === undefined) {
        return refuse(
          diagnostic(
            'DSHX6305',
            `${project.clientEntry} is not a DSHX defineClientPlugin default export.`,
            project.clientEntry,
            'Export default defineClientPlugin({ ... }), or wire the panel with api.panels.register by hand.',
          ),
        )
      }
      const setup = SourceSyntax.objectProperty({ expression: object, name: 'setup' })
      if (setup === undefined) {
        return refuse(
          diagnostic(
            'DSHX6306',
            `The defineClientPlugin call in ${project.clientEntry} has no setup to wire into.`,
            project.clientEntry,
            'Add a setup(api) body to the Client entry.',
          ),
        )
      }
      const span = setupBodyOpenBrace(setup.value)
      if (span === undefined) {
        return refuse(
          diagnostic(
            'DSHX6306',
            `The setup body in ${project.clientEntry} is not a block function.`,
            project.clientEntry,
            'Write setup as a block function body so the panel registration can be inserted.',
          ),
        )
      }
      const bodyText = clientBefore.slice(span.open, span.close)
      const alreadyRegistered = bodyText.includes(`api.panels.register({ id: '${id}',`)
      if (alreadyRegistered)
        return refuse(
          diagnostic(
            'DSHX6309',
            `The Client entry already registers panel ${JSON.stringify(id)}.`,
            project.clientEntry,
            'Choose another panel id; no wiring edits were made.',
            'warning',
          ),
        )
      const usesProperty = SourceSyntax.objectProperty({ expression: object, name: 'uses' })
      const hasPanelsCapability = usesProperty !== undefined && usesLiteralIncludes(usesProperty.value, 'panels')
      const edits: { start: number; end: number; text: string }[] = []
      if (usesProperty !== undefined && !hasPanelsCapability) {
        const array = usesArray(usesProperty.value)
        if (array === undefined) {
          return refuse(
            diagnostic(
              'DSHX6306',
              `The uses list in ${project.clientEntry} is not a literal array.`,
              project.clientEntry,
              'Declare uses: ["panels"] literally, or wire the panel registration by hand.',
            ),
          )
        }
        addArrayElement(edits, array, `'panels'`)
      } else if (usesProperty === undefined) {
        insertObjectProperty(edits, clientBefore, object, "  uses: ['panels'],")
      }
      const importEnd = SourceSyntax.lastImportEnd(program)
      const hasLayoutTypeImport = clientBefore.includes('@deepseek-ai/dsh-client-ui-layout/client')
      const importPath = relativeImport(project.clientEntry, resolve(project.root, `src/${symbols.stem}-panel.tsx`))
      edits.push({
        start: importEnd,
        end: importEnd,
        text: `\n${hasLayoutTypeImport ? '' : "import type {} from '@deepseek-ai/dsh-client-ui-layout/client'\n"}import { ${symbols.component} } from '${importPath}'${clientBefore[importEnd] === '\n' ? '' : '\n'}`,
      })
      const registration = `${bodyText.trimStart() === '' ? ' ' : '\n'}api.panels.register({ id: '${id}', title: '${options.title ?? id}', component: ${symbols.component} })\n`
      edits.push({ start: span.open, end: span.open, text: registration })
      plan.push({ file: project.clientEntry, before: clientBefore, after: applyEdits(clientBefore, edits) })
    }
  }

  if (preset === 'api') {
    if (project.hostEntry === undefined || !inside(project.root, project.hostEntry)) {
      return refuse(
        diagnostic(
          'DSHX6301',
          'A Host entry is required to wire an API handler.',
          project.packageFile,
          'Create the host entry that exports default definePlugin, then run dshx add api again.',
        ),
      )
    }
    const hostBefore = await readExisting(fs, project.hostEntry)
    if (hostBefore === undefined) {
      return refuse(
        diagnostic(
          'DSHX6301',
          `The Host entry ${project.hostEntry} does not exist.`,
          project.packageFile,
          'Create it exporting default definePlugin, then run dshx add api again.',
        ),
      )
    }
    const program = parse(hostBefore, project.hostEntry)
    if (program === undefined) {
      return refuse(
        diagnostic('DSHX6307', `The Host entry ${project.hostEntry} does not parse.`, project.hostEntry, 'Fix the entry source before adding an API.'),
      )
    }
    const symbol = symbols.hostSymbol
    const wired = new RegExp(`\\b${symbol}\\b`).test(hostBefore)
    if (wired)
      return refuse(
        diagnostic(
          'DSHX6309',
          `The Host entry already references ${symbol}.`,
          project.hostEntry,
          'Keep the existing contribution; no wiring edits were made.',
          'warning',
        ),
      )
    const object = defaultDefinition(program, 'definePlugin')
    if (object === undefined) {
      return refuse(
        diagnostic(
          'DSHX6305',
          `${project.hostEntry} is not a DSHX definePlugin default export.`,
          project.hostEntry,
          'Export default definePlugin({ ... }) and add the handler symbol to apis: [...], or wire it by hand.',
        ),
      )
    }
    const importPath = relativeImport(project.hostEntry, resolve(project.root, `src/${symbols.stem}-host.ts`))
    const importText = `import { ${symbol} } from '${importPath}'`
    const importEnd = SourceSyntax.lastImportEnd(program)
    const apiImportEdit = { start: importEnd, end: importEnd, text: `\n${importText}${hostBefore[importEnd] === '\n' ? '' : '\n'}` }
    const apis = SourceSyntax.objectProperty({ expression: object, name: 'apis' })
    if (apis === undefined) {
      const edits: { start: number; end: number; text: string }[] = [apiImportEdit]
      insertObjectProperty(edits, hostBefore, object, `  apis: [${symbol}],`)
      plan.push({ file: project.hostEntry, before: hostBefore, after: applyEdits(hostBefore, edits) })
    } else if (apis.value.type === 'ArrayExpression') {
      const edits: { start: number; end: number; text: string }[] = [apiImportEdit]
      addArrayElement(edits, apis.value, symbol)
      plan.push({ file: project.hostEntry, before: hostBefore, after: applyEdits(hostBefore, edits) })
    } else {
      return refuse(
        diagnostic(
          'DSHX6306',
          `The apis field in ${project.hostEntry} is not a literal array.`,
          project.hostEntry,
          'List the handler symbol in apis: [...] literally, or wire it by hand.',
        ),
      )
    }
  }

  /**
   * New files stage after every precondition has passed: a dry-run previews the
   * exact plan, and an applied plan either fully lands or fully rolls back.
   */
  if (packageChanged) plan.push({ file: project.packageFile, before: packageBefore, after: packageAfter })
  for (const file of ScaffoldPresets.files({ preset, id, packageId: project.packageId })) {
    plan.push({ file: resolve(project.root, file.path), after: file.content })
  }

  const diff = ScaffoldFilePlan.renderFileDiff(plan.map(toFilePlan))
  if (options.dryRun) return finish(diff)
  const filePlan = plan.map(toFilePlan)
  try {
    await ScaffoldFilePlan.applyFilePlanWithFileSystem(filePlan, fs)
  } catch (cause) {
    return refuse(
      diagnostic(
        'DSHX6307',
        `Failed to write ${preset} scaffold: ${cause instanceof Error ? cause.message : String(cause)}`,
        project.packageFile,
        'Fix filesystem permissions and retry; no partial changes were kept.',
      ),
    )
  }
  const compatibility = options.compatibility ?? DEFAULT_COMPATIBILITY
  let postDiagnostics: readonly DshxDiagnostic[]
  try {
    postDiagnostics = await (dependencies.checkManifest ?? checkProjectManifest)(
      { ...project, ...(clientEntryForCheck !== undefined && { clientEntry: clientEntryForCheck }), manifest: jsonObjectSchema.parse(updatedManifest) },
      { compatibility },
    )
  } catch (cause) {
    await ScaffoldFilePlan.rollbackFilePlanWithFileSystem(filePlan, fs)
    return refuse(
      diagnostic(
        'DSHX6308',
        `Generated ${preset} scaffold could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
        project.packageFile,
        'Fix the project manifest or compatibility adapter before generating.',
      ),
    )
  }
  if (postDiagnostics.some(item => item.severity === 'error')) {
    await ScaffoldFilePlan.rollbackFilePlanWithFileSystem(filePlan, fs)
    diagnostics.push(...postDiagnostics)
    return finish()
  }
  diagnostics.push(...postDiagnostics)
  return finish(diff)
}

const usesLiteralIncludes = (expression: Expression, literal: string): boolean => {
  const array = usesArray(expression)
  return (
    array !== undefined &&
    array.elements.some(
      element => element !== null && element.type !== 'SpreadElement' && SourceSyntax.stringValue(SourceSyntax.unwrapExpression(element)) === literal,
    )
  )
}

const usesArray = (expression: Expression): ArrayExpression | undefined => {
  const value = SourceSyntax.unwrapExpression(expression)
  return value.type === 'ArrayExpression' ? value : undefined
}
