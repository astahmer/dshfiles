import { dirname, relative, resolve } from 'node:path'
import type { Program, ObjectProperty } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { checkProjectManifest } from '../project/index.js'
import { ScaffoldFilePlan } from './common.js'
import type { FilePlan } from './common.js'

export interface AddHookOptions {
  readonly project: ResolvedDshxConfig
  readonly event: string
  readonly file?: string
  readonly dryRun?: boolean
}

export interface AddHookResult {
  readonly root: string
  readonly event: string
  readonly changedFiles: readonly string[]
  readonly generatedFiles: readonly string[]
  readonly diagnostics: readonly DshxDiagnostic[]
  readonly dryRun: boolean
  readonly diff?: string
}

export interface AddHookDependencies {
  readonly checkManifest?: typeof checkProjectManifest
}

function diagnostic(code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic {
  return { code, severity, message, file, hint }
}

function safeFileName(event: string): string {
  const value = event.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return value === '' ? 'hook' : value
}

function importPath(from: string, to: string): string {
  let value = relative(dirname(from), to).replaceAll('\\', '/')
  if (!value.startsWith('.')) value = `./${value}`
  return value.replace(/\.ts$/, '.js')
}

function registerName(event: string): string {
  const value = event.replace(/[^a-zA-Z0-9_$]+/g, ' ').trim()
  const identifier =
    value === ''
      ? 'Hook'
      : value
          .split(/\s+/)
          .map(part => part.replace(/^([a-z])/, (_, first: string) => first.toUpperCase()))
          .join('')
  return `register${identifier}Hook`
}

function sourceForHook(event: string): string {
  return `import type { Context } from '@dshfiles/dshx/host'\n\nexport function ${registerName(event)}(ctx: Context) {\n  return ctx.on(${JSON.stringify(event)}, (...args: unknown[]) => {\n    void args\n    // Add hook behavior here.\n  })\n}\n`
}

const hasHookRegistration = (program: Program, event: string): boolean => {
  let found = false
  SourceSyntax.visit({
    program,
    visitor: {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || SourceSyntax.propertyName(callee.property) !== 'on') return
        const argument = node.arguments[0]
        if (argument !== undefined && argument.type !== 'SpreadElement' && SourceSyntax.stringValue(argument) === event) found = true
      },
    },
  })
  return found
}

const findSetupBody = (setup: ObjectProperty) => {
  const value = setup.value
  if (setup.kind !== 'init' || (value.type !== 'FunctionExpression' && value.type !== 'ArrowFunctionExpression')) return undefined
  if (value.body?.type !== 'BlockStatement') return undefined
  return { body: value.body, parameter: value.params[0] }
}

function modifyHost(source: string, hostFile: string, hookFile: string, event: string): { source?: string; duplicate: boolean; invalidSetup: boolean } {
  const sourceFile = SourceSyntax.parse({ file: hostFile, source })
  if (hasHookRegistration(sourceFile, event)) return { duplicate: true, invalidSetup: false }
  const call = SourceSyntax.defaultCall({ program: sourceFile, name: 'defineHost' })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression')
    return { duplicate: false, invalidSetup: false }
  const setup = SourceSyntax.objectProperty({ expression: argument, name: 'setup' })
  const edits: Array<{ start: number; end: number; text: string }> = []
  const name = registerName(event)
  if (setup === undefined) {
    const close = argument.end - 1
    const prefix = argument.properties.length === 0 ? '' : '\n'
    const suffix = argument.properties.length === 0 ? '\n' : ''
    edits.push({ start: close, end: close, text: `${prefix}  setup(ctx) {\n    ${name}(ctx)\n  },${suffix}` })
  } else {
    const body = findSetupBody(setup)
    if (body === undefined) return { duplicate: false, invalidSetup: true }
    const contextName = body.parameter === undefined ? 'ctx' : body.parameter.type === 'Identifier' ? body.parameter.name : undefined
    if (contextName === undefined) return { duplicate: false, invalidSetup: true }
    if (body.parameter === undefined) {
      const open = setup.start
      const text = source.slice(open, body.body.start)
      const paren = text.indexOf('(')
      if (paren < 0) return { duplicate: false, invalidSetup: true }
      edits.push({ start: open + paren + 1, end: open + paren + 1, text: 'ctx' })
    }
    const start = body.body.start + 1
    const existing = source.slice(start, body.body.end)
    const indent = /\n([ \t]*)[^\s]/.exec(existing)?.[1] ?? '  '
    edits.push({ start, end: start, text: `\n${indent}${name}(${contextName})\n` })
  }
  const importEnd = SourceSyntax.lastImportEnd(sourceFile)
  edits.push({
    start: importEnd,
    end: importEnd,
    text: `${importEnd === 0 ? '' : '\n'}import { ${name} } from ${JSON.stringify(importPath(hostFile, hookFile))}\n`,
  })
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  return { source: result, duplicate: false, invalidSetup: false }
}

function newHostSource(hostFile: string, hookFile: string, event: string): string {
  return `import { defineHost } from '@dshfiles/dshx/host'\nimport { ${registerName(event)} } from ${JSON.stringify(importPath(hostFile, hookFile))}\n\nexport default defineHost({\n  setup(ctx) {\n    ${registerName(event)}(ctx)\n  },\n})\n`
}

function makeResult(
  project: ResolvedDshxConfig,
  options: AddHookOptions,
  diagnostics: readonly DshxDiagnostic[],
  plan: readonly FilePlan[],
  diff?: string,
): AddHookResult {
  return {
    root: project.root,
    event: options.event,
    changedFiles: plan.map(item => item.file),
    generatedFiles: plan.filter(item => item.before === undefined).map(item => item.file),
    diagnostics,
    dryRun: options.dryRun ?? false,
    ...(diff === undefined ? {} : { diff }),
  }
}

function explicitHostDisabled(project: ResolvedDshxConfig, configSource: string | undefined): boolean {
  return project.hostEntry === undefined && configSource !== undefined && /(?:^|[,{\n])\s*host\s*:\s*false\b/.test(configSource)
}

/** Generate a native Cordis ctx.on hook and attach it to a DSHX Host setup. */
export async function createHookScaffold(options: AddHookOptions, dependencies: AddHookDependencies = {}): Promise<AddHookResult> {
  const { project } = options
  const packageFile = project.packageFile
  if (options.event.trim() === '' || /\s/.test(options.event) || options.event.includes('/') || options.event.includes('\\')) {
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6301',
          'Hook event must be a non-empty event name without whitespace or path separators.',
          packageFile,
          'Pass --event <event.name> using the official Cordis event name.',
        ),
      ],
      [],
    )
  }
  const hookFile = resolve(project.root, options.file ?? `src/hooks/${safeFileName(options.event)}.ts`)
  if (!ScaffoldFilePlan.insideProject(project.root, hookFile) || !hookFile.endsWith('.ts')) {
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6302',
          `Hook file must be a .ts path inside the project root: ${hookFile}.`,
          packageFile,
          'Use --file with a path such as src/hooks/before-request.ts.',
        ),
      ],
      [],
    )
  }
  const existingHook = await ScaffoldFilePlan.readOptionalFile(hookFile)
  if (existingHook !== undefined) {
    const ast = SourceSyntax.parse({ file: hookFile, source: existingHook })
    if (hasHookRegistration(ast, options.event))
      return makeResult(
        project,
        options,
        [
          diagnostic(
            'DSHX6306',
            `Hook for ${JSON.stringify(options.event)} is already registered in ${hookFile}.`,
            hookFile,
            'Keep the existing Hook; no files were changed.',
            'warning',
          ),
        ],
        [],
      )
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6302',
          `Hook file already exists: ${hookFile}.`,
          hookFile,
          'Choose another --file path or remove the existing file after reviewing it.',
        ),
      ],
      [],
    )
  }
  const hostFile = project.hostEntry ?? resolve(project.root, 'src/host.ts')
  if (!ScaffoldFilePlan.insideProject(project.root, hostFile))
    return makeResult(
      project,
      options,
      [diagnostic('DSHX6302', `Host file must stay inside the project root: ${hostFile}.`, packageFile, 'Move the Host entry under the project root.')],
      [],
    )
  const configSource = project.configFile === undefined ? undefined : await ScaffoldFilePlan.readOptionalFile(project.configFile)
  if (explicitHostDisabled(project, configSource))
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6303',
          'Host is explicitly disabled for this project.',
          project.configFile ?? packageFile,
          'Remove host: false or register hooks through a project with an enabled Host face.',
        ),
      ],
      [],
    )
  const hostBefore = await ScaffoldFilePlan.readOptionalFile(hostFile)
  let hostAfter: string
  if (hostBefore === undefined) hostAfter = newHostSource(hostFile, hookFile, options.event)
  else {
    const modified = modifyHost(hostBefore, hostFile, hookFile, options.event)
    if (modified.duplicate)
      return makeResult(
        project,
        options,
        [
          diagnostic(
            'DSHX6306',
            `Hook for ${JSON.stringify(options.event)} is already registered in ${hostFile}.`,
            hostFile,
            'Keep the existing Hook; no files were changed.',
            'warning',
          ),
        ],
        [],
      )
    if (modified.invalidSetup)
      return makeResult(
        project,
        options,
        [
          diagnostic(
            'DSHX6305',
            `Host setup in ${hostFile} is not a block function that can be safely extended.`,
            hostFile,
            'Convert setup to setup(ctx) { ... } and run add hook again.',
          ),
        ],
        [],
      )
    if (modified.source === undefined)
      return makeResult(
        project,
        options,
        [
          diagnostic(
            'DSHX6304',
            `Host ${hostFile} is not a DSHX defineHost default export.`,
            hostFile,
            'Export default defineHost({ setup(ctx) { ... } }) or register the Hook manually in native Host code.',
          ),
        ],
        [],
      )
    hostAfter = modified.source
  }
  const plan: FilePlan[] = [
    { file: hookFile, after: sourceForHook(options.event) },
    ...(hostBefore === undefined ? [{ file: hostFile, after: hostAfter }] : [{ file: hostFile, before: hostBefore, after: hostAfter }]),
  ]
  if (options.dryRun) return makeResult(project, options, [], plan, ScaffoldFilePlan.renderFileDiff(plan))
  try {
    await ScaffoldFilePlan.applyFilePlan(plan)
  } catch (cause) {
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6307',
          `Failed to write Hook scaffold: ${cause instanceof Error ? cause.message : String(cause)}`,
          hookFile,
          'Fix filesystem permissions and retry; no partial changes were kept.',
        ),
      ],
      [],
    )
  }
  const postProject: ResolvedDshxConfig = { ...project, ...(hostBefore === undefined ? { hostEntry: hostFile } : {}) }
  let postDiagnostics: readonly DshxDiagnostic[]
  try {
    postDiagnostics = await (dependencies.checkManifest ?? checkProjectManifest)(postProject)
  } catch (cause) {
    await ScaffoldFilePlan.rollbackFilePlan(plan)
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6308',
          `Generated Hook scaffold could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
          packageFile,
          'Fix the project manifest before generating a Hook.',
        ),
      ],
      [],
    )
  }
  if (postDiagnostics.some(item => item.severity === 'error')) {
    await ScaffoldFilePlan.rollbackFilePlan(plan)
    return makeResult(
      project,
      options,
      [
        diagnostic(
          'DSHX6308',
          'Generated Hook scaffold failed Manifest Checker validation and was rolled back.',
          packageFile,
          'Fix the project manifest before generating a Hook.',
        ),
        ...postDiagnostics,
      ],
      [],
    )
  }
  return makeResult(project, options, postDiagnostics, plan)
}
