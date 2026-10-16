import { dirname, relative, resolve } from 'node:path'
import type { Program } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { checkProjectManifest } from '../project/index.js'
import { ScaffoldFilePlan } from './common.js'
import type { FilePlan } from './common.js'

export interface AddToolOptions {
  readonly project: ResolvedDshxConfig
  readonly name: string
  readonly description?: string
  readonly file?: string
  readonly dryRun?: boolean
}

export interface AddToolResult {
  readonly root: string
  readonly name: string
  readonly changedFiles: readonly string[]
  readonly generatedFiles: readonly string[]
  readonly diagnostics: readonly DshxDiagnostic[]
  readonly dryRun: boolean
  readonly diff?: string
}

export interface AddToolDependencies {
  readonly checkManifest?: typeof checkProjectManifest
}

function diagnostic(code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic {
  return { code, severity, message, file, hint }
}

function safeName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
  if (name === '') return 'GeneratedTool'
  return /^[0-9]/.test(name) ? `Tool_${name}` : name
}

function safeFileName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return name === '' ? 'tool' : name
}

function toolIdentifier(name: string): string {
  return `${safeName(name)}Tool`
}

function sourceForTool(name: string, description: string): string {
  const identifier = toolIdentifier(name)
  return `import { defineTool } from '@dshfiles/dshx/host'\n\nexport const ${identifier} = defineTool({\n  name: ${JSON.stringify(name)},\n  description: ${JSON.stringify(description)},\n  parameters: {},\n  output: {\n    schema: { type: 'string' },\n    render: (_args, value) => [{ type: 'text', text: value }],\n  },\n  async execute() {\n    return ${JSON.stringify(`Implement ${name}`)}\n  },\n})\n`
}

const hasTool = (program: Program, name: string): boolean => {
  let found = false
  SourceSyntax.visit({
    program,
    visitor: {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineTool') return
        const argument = node.arguments[0]
        if (argument === undefined || argument.type === 'SpreadElement') return
        const property = SourceSyntax.objectProperty({ expression: argument, name: 'name' })
        if (property !== undefined && SourceSyntax.stringValue(property.value) === name) found = true
      },
    },
  })
  return found
}

function modifyHost(source: string, hostFile: string, toolFile: string, name: string): { source?: string; duplicate: boolean; invalidTools: boolean } {
  const sourceFile = SourceSyntax.parse({ file: hostFile, source })
  if (hasTool(sourceFile, name)) return { duplicate: true, invalidTools: false }
  const call = SourceSyntax.defaultCall({ program: sourceFile, name: 'defineHost' })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression')
    return { duplicate: false, invalidTools: false }
  const tools = SourceSyntax.objectProperty({ expression: argument, name: 'tools' })
  if (tools !== undefined && tools.value.type !== 'ArrayExpression') return { duplicate: false, invalidTools: true }
  const identifier = toolIdentifier(name)
  let importPath = relative(dirname(hostFile), toolFile).replaceAll('\\', '/')
  if (!importPath.startsWith('.')) importPath = `./${importPath}`
  importPath = importPath.replace(/\.ts$/, '.js')
  const importEnd = SourceSyntax.lastImportEnd(sourceFile)
  const edits: Array<{ start: number; end: number; text: string }> = [
    {
      start: importEnd,
      end: importEnd,
      text: `${importEnd === 0 ? '' : '\n'}import { ${identifier} } from ${JSON.stringify(importPath)}\n`,
    },
  ]
  if (tools !== undefined && tools.value.type === 'ArrayExpression') {
    edits.push({ start: tools.value.end - 1, end: tools.value.end - 1, text: `${tools.value.elements.length > 0 ? ', ' : ''}${identifier}` })
  } else {
    const objectText = source.slice(argument.start, argument.end)
    const openBrace = argument.start + objectText.indexOf('{') + 1
    edits.push({
      start: openBrace,
      end: openBrace,
      text: `${argument.properties.length > 0 ? '\n' : ''}  tools: [${identifier}],${argument.properties.length > 0 ? '' : '\n'}`,
    })
  }
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  return { source: result, duplicate: false, invalidTools: false }
}

function newHostSource(toolFile: string, hostFile: string, name: string): string {
  let importPath = relative(dirname(hostFile), toolFile).replaceAll('\\', '/')
  if (!importPath.startsWith('.')) importPath = `./${importPath}`
  importPath = importPath.replace(/\.ts$/, '.js')
  return `import { defineHost } from '@dshfiles/dshx/host'\nimport { ${toolIdentifier(name)} } from ${JSON.stringify(importPath)}\n\nexport default defineHost({\n  tools: [${toolIdentifier(name)}],\n})\n`
}

function result(
  project: ResolvedDshxConfig,
  options: AddToolOptions,
  diagnostics: readonly DshxDiagnostic[],
  plan: readonly FilePlan[],
  diffText?: string,
): AddToolResult {
  return {
    root: project.root,
    name: options.name,
    changedFiles: plan.map(item => item.file),
    generatedFiles: plan.filter(item => item.before === undefined).map(item => item.file),
    diagnostics,
    dryRun: options.dryRun ?? false,
    ...(diffText === undefined ? {} : { diff: diffText }),
  }
}

function explicitHostDisabled(project: ResolvedDshxConfig, configSource: string | undefined): boolean {
  return project.hostEntry === undefined && configSource !== undefined && /(?:^|[,{\n])\s*host\s*:\s*false\b/.test(configSource)
}

/** Generate an official defineTool skeleton and attach it to a DSHX Host. */
export async function createToolScaffold(options: AddToolOptions, dependencies: AddToolDependencies = {}): Promise<AddToolResult> {
  const { project } = options
  const file = project.packageFile
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.name) || options.name.trim() !== options.name) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6201',
          `Invalid Tool name ${JSON.stringify(options.name)}.`,
          file,
          'Use a non-empty name containing letters, numbers, dots, hyphens, or underscores.',
        ),
      ],
      [],
    )
  }
  const toolFile = resolve(project.root, options.file ?? `src/tools/${safeFileName(options.name)}.ts`)
  if (!ScaffoldFilePlan.insideProject(project.root, toolFile) || !toolFile.endsWith('.ts')) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6202',
          `Tool file must be a .ts path inside the project root: ${toolFile}.`,
          file,
          'Use --file with a path such as src/tools/status.ts.',
        ),
      ],
      [],
    )
  }
  const existingToolFile = await ScaffoldFilePlan.readOptionalFile(toolFile)
  if (existingToolFile !== undefined) {
    const ast = SourceSyntax.parse({ file: toolFile, source: existingToolFile })
    if (hasTool(ast, options.name))
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6206',
            `Tool ${JSON.stringify(options.name)} is already defined in ${toolFile}.`,
            toolFile,
            'Keep the existing Tool; no files were changed.',
            'warning',
          ),
        ],
        [],
      )
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6202',
          `Tool file already exists: ${toolFile}.`,
          toolFile,
          'Choose another --file path or remove the existing file after reviewing it.',
        ),
      ],
      [],
    )
  }
  const hostFile = project.hostEntry ?? resolve(project.root, 'src/host.ts')
  if (!ScaffoldFilePlan.insideProject(project.root, hostFile))
    return result(
      project,
      options,
      [diagnostic('DSHX6202', `Host file must stay inside the project root: ${hostFile}.`, file, 'Move the Host entry under the project root.')],
      [],
    )
  const configSource = project.configFile === undefined ? undefined : await ScaffoldFilePlan.readOptionalFile(project.configFile)
  if (explicitHostDisabled(project, configSource))
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6203',
          'Host is explicitly disabled for this project.',
          project.configFile ?? file,
          'Remove host: false or create the Tool through a project with an enabled Host face.',
        ),
      ],
      [],
    )
  const hostBefore = await ScaffoldFilePlan.readOptionalFile(hostFile)
  const toolAfter = sourceForTool(options.name, options.description ?? 'Generated DSHX tool.')
  let hostAfter: string
  if (hostBefore === undefined) {
    hostAfter = newHostSource(toolFile, hostFile, options.name)
  } else {
    const modified = modifyHost(hostBefore, hostFile, toolFile, options.name)
    if (modified.duplicate)
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6206',
            `Tool ${JSON.stringify(options.name)} is already registered in ${hostFile}.`,
            hostFile,
            'Keep the existing Tool; no files were changed.',
            'warning',
          ),
        ],
        [],
      )
    if (modified.invalidTools)
      return result(
        project,
        options,
        [diagnostic('DSHX6205', 'Host defineHost tools must be an array.', hostFile, 'Change tools to an array of official ToolDefinition values.')],
        [],
      )
    if (modified.source === undefined)
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6204',
            `Host ${hostFile} is not a DSHX defineHost default export.`,
            hostFile,
            'Export default defineHost({ tools: [...] }) or register the Tool manually in native Host code.',
          ),
        ],
        [],
      )
    hostAfter = modified.source
  }
  const plan: FilePlan[] = [
    { file: toolFile, after: toolAfter },
    ...(hostBefore === undefined ? [{ file: hostFile, after: hostAfter }] : [{ file: hostFile, before: hostBefore, after: hostAfter }]),
  ]
  if (options.dryRun) return result(project, options, [], plan, ScaffoldFilePlan.renderFileDiff(plan))
  try {
    await ScaffoldFilePlan.applyFilePlan(plan)
  } catch (cause) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6207',
          `Failed to write Tool scaffold: ${cause instanceof Error ? cause.message : String(cause)}`,
          toolFile,
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
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6208',
          `Generated Tool scaffold could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
          file,
          'Fix the project manifest before generating a Tool.',
        ),
      ],
      [],
    )
  }
  if (postDiagnostics.some(item => item.severity === 'error')) {
    await ScaffoldFilePlan.rollbackFilePlan(plan)
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6208',
          'Generated Tool scaffold failed Manifest Checker validation and was rolled back.',
          file,
          'Fix the project manifest before generating a Tool.',
        ),
        ...postDiagnostics,
      ],
      [],
    )
  }
  return result(project, options, postDiagnostics, plan)
}
