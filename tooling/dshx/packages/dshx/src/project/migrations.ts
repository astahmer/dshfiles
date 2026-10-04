import { readFile, readdir } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { ObjectExpression } from 'oxc-parser'
import type { ResolvedDshxConfig } from '../config/types.js'
import type { DshxDiagnostic } from '../diagnostics.js'
import { parseSource, propertyName, stringValue, visitSource } from './syntax.js'

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

const analyzeSource = ({ file, source }: { file: string; source: string }): DshxDiagnostic[] => {
  const diagnostics: DshxDiagnostic[] = []
  const program = parseSource({ file, source })
  const bindings = {
    host: new Set<string>(),
    client: new Set<string>(),
    conversation: new Set<string>(),
    slot: new Set<string>(),
    config: new Set<string>(),
  }
  const lifecycles = new Set<string>()
  const issue = (message: string, hint: string): void => {
    diagnostics.push({ code: 'DSHX4501', severity: 'error', message, file, hint })
  }
  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    const request = statement.source.value
    if (request === '@dshfiles/dshx') {
      const removed = statement.specifiers
        .filter(specifier => specifier.type === 'ImportSpecifier')
        .map(specifier => propertyName(specifier.imported))
        .filter(name => name !== 'defineConfig' && name !== 'DshxConfig')
      if (removed.length > 0) issue(`The root entry no longer exports ${removed.join(', ')}.`, 'Import each author API from its dedicated stable subpath.')
    }
    if (['@dshfiles/dshx/compiler', '@dshfiles/dshx/compat', '@dshfiles/dshx/cli'].includes(request)) {
      issue(`${request} was consolidated into experimental tooling.`, 'Import the programmatic API from @dshfiles/dshx/tooling.')
    }
    if (request === '@dshfiles/dshx/conversation') {
      issue(
        'Conversation moved to its explicit experimental entry.',
        'Import from @dshfiles/dshx/experimental/conversation and migrate to lifecycle.render(Component).',
      )
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      const imported = propertyName(specifier.imported)
      const local = specifier.local.name
      if (request === '@dshfiles/dshx/host' && imported === 'defineHost') bindings.host.add(local)
      if (request === '@dshfiles/dshx/client' && imported === 'defineClient') bindings.client.add(local)
      if (request === '@dshfiles/dshx/client' && imported === 'defineSlot') bindings.slot.add(local)
      if (['@dshfiles/dshx', '@dshfiles/dshx/config'].includes(request) && imported === 'defineConfig') bindings.config.add(local)
      if (['@dshfiles/dshx/conversation', '@dshfiles/dshx/experimental/conversation'].includes(request) && imported === 'defineConversation')
        bindings.conversation.add(local)
      if (request === '@dshfiles/dshx/client' && imported === 'useQuery')
        issue('useQuery was renamed to useApiQuery.', 'Import and call useApiQuery from @dshfiles/dshx/client.')
      if (imported === 'defineConversationNode')
        issue(
          'defineConversationNode() and the separate renderer Slot were removed.',
          'Use defineConversation({ kind, events, initial, reduce, project }).render(Component) from @dshfiles/dshx/experimental/conversation.',
        )
    }
  }
  visitSource({
    program,
    visitor: {
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          node.init?.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          bindings.conversation.has(node.init.callee.name)
        )
          lifecycles.add(node.id.name)
      },
    },
  })
  const checkConfig = (object: ObjectExpression): void => {
    for (const property of object.properties) {
      if (property.type !== 'Property') continue
      const name = propertyName(property.key)
      const value = stringValue(property.value)
      if ((name === 'host' || name === 'client') && value !== undefined)
        issue(`String shorthand for config.${name} was removed.`, `Use ${name}: { entry: ${JSON.stringify(value)} }.`)
    }
  }
  visitSource({
    program,
    visitor: {
      CallExpression(node) {
        const callee = node.callee
        const argument = node.arguments[0]
        if (callee.type === 'Identifier') {
          if (argument?.type === 'ObjectExpression') {
            if (bindings.config.has(callee.name)) checkConfig(argument)
            for (const property of argument.properties) {
              if (property.type !== 'Property') continue
              const name = propertyName(property.key)
              if (bindings.host.has(callee.name) && name === 'api') issue('defineHost({ api }) was removed.', 'Use defineHost({ apis: [contract.host(...)] }).')
              if (bindings.client.has(callee.name)) {
                if (name === 'api' || name === 'apis')
                  issue(`defineClient({ ${name} }) was removed.`, 'Delete the field; retained useApi/useApiQuery Hooks infer the Client capability.')
                if (name === 'conversationNodes')
                  issue(
                    'defineClient({ conversationNodes }) was replaced by integrated Conversation contributions.',
                    'Use conversations: [lifecycle.render(Component)] and remove the separate conversation.chat.node Slot.',
                  )
              }
              if (bindings.conversation.has(callee.name) && name === 'view')
                issue('Conversation view was renamed to project.', 'Move projection logic to project(), then attach React with lifecycle.render(Component).')
            }
          }
          if (
            bindings.slot.has(callee.name) &&
            argument !== undefined &&
            argument.type !== 'SpreadElement' &&
            stringValue(argument) === 'conversation.chat.node'
          )
            issue(
              'A separate conversation.chat.node renderer Slot is no longer required.',
              'Pass the React component to lifecycle.render(Component) and register the result in defineClient({ conversations }).',
            )
        }
        if (callee.type === 'MemberExpression' && !callee.computed && propertyName(callee.property) === 'component') {
          const object = callee.object
          if (
            (object.type === 'Identifier' && lifecycles.has(object.name)) ||
            (object.type === 'CallExpression' && object.callee.type === 'Identifier' && bindings.conversation.has(object.callee.name))
          )
            issue(
              'Conversation .component(...) was replaced by .render(Component).',
              'Keep lifecycle callbacks in defineConversation(...) and pass only the React renderer to .render(...).',
            )
        }
      },
      ExportDefaultDeclaration(node) {
        if (file.endsWith('dshx.config.ts') && node.declaration.type === 'ObjectExpression') checkConfig(node.declaration)
      },
    },
  })
  return diagnostics
}

export const checkMigrationDiagnostics = async (config: ResolvedDshxConfig): Promise<DshxDiagnostic[]> => {
  const files = ['dshx.config.ts']
  try {
    const names = await readdir(resolve(config.root, 'src'), { recursive: true })
    files.push(
      ...names
        .filter(name => sourceExtensions.has(extname(name)) && !name.split(sep).some(part => ['node_modules', 'dist', '.git'].includes(part)))
        .map(name => `src/${name}`),
    )
  } catch {
    /* Projects may intentionally have no src directory. */
  }
  const diagnostics: DshxDiagnostic[] = []
  for (const name of files) {
    const file = resolve(config.root, name)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    diagnostics.push(...analyzeSource({ file, source }))
  }
  return diagnostics
}
