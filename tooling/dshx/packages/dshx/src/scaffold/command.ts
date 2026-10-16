import { dirname, relative, resolve } from 'node:path'
import type { Program } from 'oxc-parser'
import { SourceSyntax } from '../project/syntax.js'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { checkProjectManifest } from '../project/index.js'
import { applyFilePlan, insideProject, readOptionalFile, renderFileDiff, rollbackFilePlan } from './common.js'
import type { FilePlan } from './common.js'

export interface AddCommandOptions {
  readonly project: ResolvedDshxConfig
  readonly name: string
  readonly description?: string
  readonly file?: string
  readonly dryRun?: boolean
}

export interface AddCommandResult {
  readonly root: string
  readonly name: string
  readonly changedFiles: readonly string[]
  readonly generatedFiles: readonly string[]
  readonly diagnostics: readonly DshxDiagnostic[]
  readonly dryRun: boolean
  readonly diff?: string
}

export interface AddCommandDependencies {
  readonly checkManifest?: typeof checkProjectManifest
}

function diagnostic(code: string, message: string, file: string, hint: string, severity: 'error' | 'warning' = 'error'): DshxDiagnostic {
  return { code, severity, message, file, hint }
}

function safeName(value: string): string {
  const name = value.replace(/[^a-zA-Z0-9_$]+/g, '_').replace(/^_+|_+$/g, '')
  if (name === '') return 'GeneratedCommand'
  return /^[0-9]/.test(name) ? `Command_${name}` : name
}

function commandIdentifier(name: string): string {
  return `${safeName(name)}Command`
}

function sourceForCommand(name: string, description: string): string {
  const identifier = commandIdentifier(name)
  return `import { defineCommand } from '@dshfiles/dshx/host'\n\nexport const ${identifier} = defineCommand({\n  name: ${JSON.stringify(name)},\n  description: ${JSON.stringify(description)},\n  handler() {\n    return { kind: 'success', text: ${JSON.stringify(`Implement /${name}`)} }\n  },\n})\n`
}

const hasCommand = (program: Program, name: string): boolean => {
  let found = false
  SourceSyntax.visit({
    program,
    visitor: {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineCommand') return
        const argument = node.arguments[0]
        if (argument === undefined || argument.type === 'SpreadElement') return
        const property = SourceSyntax.objectProperty({ expression: argument, name: 'name' })
        if (property !== undefined && SourceSyntax.stringValue(property.value) === name) found = true
      },
    },
  })
  return found
}

function importPath(from: string, to: string): string {
  let path = relative(dirname(from), to).replaceAll('\\', '/')
  if (!path.startsWith('.')) path = `./${path}`
  return path.replace(/\.ts$/, '.js')
}

function modifyHost(source: string, hostFile: string, commandFile: string, name: string): { source?: string; duplicate: boolean; invalidCommands: boolean } {
  const sourceFile = SourceSyntax.parse({ file: hostFile, source })
  if (hasCommand(sourceFile, name)) return { duplicate: true, invalidCommands: false }
  const call = SourceSyntax.defaultCall({ program: sourceFile, name: 'defineHost' })
  const argument = call?.arguments[0]
  if (call === undefined || call.arguments.length !== 1 || argument === undefined || argument.type !== 'ObjectExpression')
    return { duplicate: false, invalidCommands: false }
  const commands = SourceSyntax.objectProperty({ expression: argument, name: 'commands' })
  if (commands !== undefined && commands.value.type !== 'ArrayExpression') return { duplicate: false, invalidCommands: true }
  const identifier = commandIdentifier(name)
  const importEnd = SourceSyntax.lastImportEnd(sourceFile)
  const edits: Array<{ start: number; end: number; text: string }> = [
    {
      start: importEnd,
      end: importEnd,
      text: `${importEnd === 0 ? '' : '\n'}import { ${identifier} } from ${JSON.stringify(importPath(hostFile, commandFile))}\n`,
    },
  ]
  if (commands !== undefined && commands.value.type === 'ArrayExpression') {
    edits.push({
      start: commands.value.end - 1,
      end: commands.value.end - 1,
      text: `${commands.value.elements.length > 0 ? ', ' : ''}${identifier}`,
    })
  } else {
    const objectText = source.slice(argument.start, argument.end)
    const openBrace = argument.start + objectText.indexOf('{') + 1
    edits.push({
      start: openBrace,
      end: openBrace,
      text: `${argument.properties.length > 0 ? '\n' : ''}  commands: [${identifier}],${argument.properties.length > 0 ? '' : '\n'}`,
    })
  }
  edits.sort((a, b) => b.start - a.start)
  let result = source
  for (const edit of edits) result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`
  return { source: result, duplicate: false, invalidCommands: false }
}

function newHostSource(commandFile: string, hostFile: string, name: string): string {
  return `import { defineHost } from '@dshfiles/dshx/host'\nimport { ${commandIdentifier(name)} } from ${JSON.stringify(importPath(hostFile, commandFile))}\n\nexport default defineHost({\n  commands: [${commandIdentifier(name)}],\n})\n`
}

function result(
  project: ResolvedDshxConfig,
  options: AddCommandOptions,
  diagnostics: readonly DshxDiagnostic[],
  plan: readonly FilePlan[],
  diff?: string,
): AddCommandResult {
  return {
    root: project.root,
    name: options.name,
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

/** Generate the smallest official Command definition and attach it to a DSHX Host. */
export async function createCommandScaffold(options: AddCommandOptions, dependencies: AddCommandDependencies = {}): Promise<AddCommandResult> {
  const { project } = options
  const file = project.packageFile
  if (!/^[a-z][a-z0-9_-]*$/.test(options.name)) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6501',
          `Invalid Command name ${JSON.stringify(options.name)}.`,
          file,
          'Use a lowercase command name beginning with a letter and containing only letters, numbers, hyphens, or underscores.',
        ),
      ],
      [],
    )
  }
  const description = options.description ?? 'Generated DSHX command.'
  if (description.trim() === '')
    return result(project, options, [diagnostic('DSHX6501', 'Command description must not be empty.', file, 'Pass a non-empty --description value.')], [])
  const commandFile = resolve(project.root, options.file ?? `src/commands/${options.name}.ts`)
  if (!insideProject(project.root, commandFile) || !commandFile.endsWith('.ts')) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6502',
          `Command file must be a .ts path inside the project root: ${commandFile}.`,
          file,
          'Use --file with a path such as src/commands/status.ts.',
        ),
      ],
      [],
    )
  }
  const existingCommandFile = await readOptionalFile(commandFile)
  if (existingCommandFile !== undefined) {
    const ast = SourceSyntax.parse({ file: commandFile, source: existingCommandFile })
    if (hasCommand(ast, options.name))
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6506',
            `Command ${JSON.stringify(options.name)} is already defined in ${commandFile}.`,
            commandFile,
            'Keep the existing Command; no files were changed.',
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
          'DSHX6502',
          `Command file already exists: ${commandFile}.`,
          commandFile,
          'Choose another --file path or remove the existing file after reviewing it.',
        ),
      ],
      [],
    )
  }
  const hostFile = project.hostEntry ?? resolve(project.root, 'src/host.ts')
  if (!insideProject(project.root, hostFile))
    return result(
      project,
      options,
      [diagnostic('DSHX6502', `Host file must stay inside the project root: ${hostFile}.`, file, 'Move the Host entry under the project root.')],
      [],
    )
  const configSource = project.configFile === undefined ? undefined : await readOptionalFile(project.configFile)
  if (explicitHostDisabled(project, configSource))
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6503',
          'Host is explicitly disabled for this project.',
          project.configFile ?? file,
          'Remove host: false or use a project with an enabled Host face.',
        ),
      ],
      [],
    )
  const hostBefore = await readOptionalFile(hostFile)
  const commandAfter = sourceForCommand(options.name, description)
  let hostAfter: string
  if (hostBefore === undefined) hostAfter = newHostSource(commandFile, hostFile, options.name)
  else {
    const modified = modifyHost(hostBefore, hostFile, commandFile, options.name)
    if (modified.duplicate)
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6506',
            `Command ${JSON.stringify(options.name)} is already registered in ${hostFile}.`,
            hostFile,
            'Keep the existing Command; no files were changed.',
            'warning',
          ),
        ],
        [],
      )
    if (modified.invalidCommands)
      return result(
        project,
        options,
        [diagnostic('DSHX6505', 'Host defineHost commands must be an array.', hostFile, 'Change commands to an array of official CommandDefinition values.')],
        [],
      )
    if (modified.source === undefined)
      return result(
        project,
        options,
        [
          diagnostic(
            'DSHX6504',
            `Host ${hostFile} is not a DSHX defineHost default export.`,
            hostFile,
            'Export default defineHost({ commands: [...] }) or register the Command manually in native Host code.',
          ),
        ],
        [],
      )
    hostAfter = modified.source
  }
  const plan: FilePlan[] = [
    { file: commandFile, after: commandAfter },
    ...(hostBefore === undefined ? [{ file: hostFile, after: hostAfter }] : [{ file: hostFile, before: hostBefore, after: hostAfter }]),
  ]
  if (options.dryRun) return result(project, options, [], plan, renderFileDiff(plan))
  try {
    await applyFilePlan(plan)
  } catch (cause) {
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6507',
          `Failed to write Command scaffold: ${cause instanceof Error ? cause.message : String(cause)}`,
          commandFile,
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
    await rollbackFilePlan(plan)
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6508',
          `Generated Command scaffold could not be validated: ${cause instanceof Error ? cause.message : String(cause)}`,
          file,
          'Fix the project manifest before generating a Command.',
        ),
      ],
      [],
    )
  }
  if (postDiagnostics.some(item => item.severity === 'error')) {
    await rollbackFilePlan(plan)
    return result(
      project,
      options,
      [
        diagnostic(
          'DSHX6508',
          'Generated Command scaffold failed Manifest Checker validation and was rolled back.',
          file,
          'Fix the project manifest before generating a Command.',
        ),
        ...postDiagnostics,
      ],
      [],
    )
  }
  return result(project, options, postDiagnostics, plan)
}
