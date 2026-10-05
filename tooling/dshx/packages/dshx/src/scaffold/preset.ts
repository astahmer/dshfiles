import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import type { ArrayExpression, Expression, ObjectExpression, Program } from 'oxc-parser'
import { parseSource, defaultCall, objectProperty, stringValue, lastImportEnd, unwrapExpression } from '../project/syntax.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import type { DshCompatibility } from '../compat/types.js'
import { DEFAULT_COMPATIBILITY } from '../compat/index.js'
import { checkProjectManifest } from '../project/index.js'
import { applyFilePlanWithFileSystem, renderFileDiff, rollbackFilePlanWithFileSystem, writeFileAtomically } from './common.js'
import { presetFiles, presetSymbols } from './presets.js'

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
  writeFileAtomic: writeFileAtomically,
}

const mergeFs = (input: Partial<ScaffoldFileSystem> | undefined): ScaffoldFileSystem => ({ ...defaultFs, ...input })

const diagnostic = (code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic => ({
  code,
  severity,
  message,
  file,
  hint,
})

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
  ...(file.before === undefined ? {} : { before: file.before }),
  after: file.after,
})

const parse = (source: string, file: string): Program | undefined => {
  try {
    return parseSource({ file, source })
  } catch {
    return undefined
  }
}

const defaultDefinition = (program: Program, name: 'defineClientPlugin' | 'definePlugin'): ObjectExpression | undefined => {
  const call = defaultCall({ program, name })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression') return undefined
  return argument
}
/** The setup body's brace position, when setup is a literal function with a block body. */
const setupBodyOpenBrace = (propertyValue: Expression): { open: number; close: number } | undefined => {
  const value = unwrapExpression(propertyValue)
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
  const symbols = presetSymbols({ preset, id, packageId: project.packageId })
  const plan: PlannedFile[] = []
  const diagnostics: DshxDiagnostic[] = []
  const finish = (diff?: string): AddPresetResult => ({
    root: project.root,
    preset,
    id,
    changedFiles: plan.map(item => item.file),
    generatedFiles: plan.filter(item => item.before === undefined).map(item => item.file),
    diagnostics,
    ...(diff === undefined ? {} : { diff }),
  })
  const refuse = async (item: DshxDiagnostic): Promise<AddPresetResult> => {
    diagnostics.push(item)
    return finish()
  }

  /**
   * Existing files first: an existing generated file means the preset ran
   * before, so nothing else may change — no second contract, no wiring edits.
   */
  for (const file of presetFiles({ preset, id, packageId: project.packageId })) {
    const absolute = resolve(project.root, file.path)
    if ((await readExisting(fs, absolute)) !== undefined) {
      return refuse(diagnostic('DSHX6302', `${absolute} already exists.`, absolute, 'Remove it or choose another id; the preset refuses to overwrite.'))
    }
  }

  /**
   * The wiring target is checked before anything is staged: a refused preset
   * leaves zero writes, whether the refusal came from a missing entry, a file
   * that does not parse, or a registration that already exists.
   */
  if (preset === 'panel') {
    if (project.clientEntry === undefined || !inside(project.root, project.clientEntry)) {
      return refuse(
        diagnostic(
          'DSHX6301',
          'A Client entry is required to wire a panel.',
          project.packageFile,
          'Add client: { entry: "src/client.tsx" } to dshx.config.ts, export defineClientPlugin, and run dshx add panel again.',
        ),
      )
    }
    const clientBefore = await readExisting(fs, project.clientEntry)
    if (clientBefore === undefined) {
      return refuse(
        diagnostic(
          'DSHX6301',
          `The Client entry ${project.clientEntry} does not exist.`,
          project.packageFile,
          'Create src/client.tsx exporting default defineClientPlugin, then run dshx add panel again.',
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
          'Export default defineClientPlugin({ ... }), or register the panel with api.panels.register by hand.',
        ),
      )
    }
    const setup = objectProperty({ expression: object, name: 'setup' })
    if (setup === undefined) {
      return refuse(
        diagnostic(
          'DSHX6306',
          `The defineClientPlugin call in ${project.clientEntry} has no setup to wire into.`,
          project.clientEntry,
          'Add a setup(api) body to the client entry.',
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
    const alreadyRegistered = bodyText.includes('panels.register') || bodyText.includes('sidebar.register')
    if (alreadyRegistered)
      return refuse(
        diagnostic(
          'DSHX6309',
          'The client entry already registers a panel.',
          project.clientEntry,
          'Keep the existing contribution; no wiring edits were made.',
          'warning',
        ),
      )
    const usesProperty = objectProperty({ expression: object, name: 'uses' })
    const injectProperty = objectProperty({ expression: object, name: 'inject' })
    const hasPanelsCapability = usesProperty !== undefined && usesLiteralIncludes(usesProperty.value, 'panels')
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
    }
    const needsInject = !hasPanelsCapability && usesProperty === undefined && injectProperty === undefined
    const edits: { start: number; end: number; text: string }[] = []
    if (usesProperty !== undefined && !hasPanelsCapability) addArrayElement(edits, usesArray(usesProperty.value)!, `'panels'`)
    if (needsInject) insertObjectProperty(edits, clientBefore, object, "  inject: ['slots', 'layout'],")
    const importEnd = lastImportEnd(program)
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
    const importEnd = lastImportEnd(program)
    const apiImportEdit = { start: importEnd, end: importEnd, text: `\n${importText}${hostBefore[importEnd] === '\n' ? '' : '\n'}` }
    const apis = objectProperty({ expression: object, name: 'apis' })
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
  for (const file of presetFiles({ preset, id, packageId: project.packageId })) {
    plan.push({ file: resolve(project.root, file.path), after: file.content })
  }

  const diff = renderFileDiff(plan.map(toFilePlan))
  if (options.dryRun) return finish(diff)
  const filePlan = plan.map(toFilePlan)
  try {
    await applyFilePlanWithFileSystem(filePlan, fs)
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
    postDiagnostics = await (dependencies.checkManifest ?? checkProjectManifest)({ ...project }, { compatibility })
  } catch (cause) {
    await rollbackFilePlanWithFileSystem(filePlan, fs)
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
    await rollbackFilePlanWithFileSystem(filePlan, fs)
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
    array.elements.some(element => element !== null && element.type !== 'SpreadElement' && stringValue(unwrapExpression(element)) === literal)
  )
}

const usesArray = (expression: Expression): ArrayExpression | undefined => {
  const value = unwrapExpression(expression)
  return value.type === 'ArrayExpression' ? value : undefined
}
