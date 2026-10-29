import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { Program, Expression, ObjectProperty, Function, ArrowFunctionExpression, ParamPattern } from 'oxc-parser'
import { CLIENT_CAPABILITIES, CLIENT_SERVICES } from 'create-dshx/capabilities'
import { CLIENT_DEFAULT_SERVICES } from 'create-dshx/runtime-capabilities'
import { SourceSyntax } from '../../project/syntax.js'

const CLIENT_PUBLIC = '@dshfiles/dshx/client'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'] as const

interface SourceCapabilityAnalysis {
  readonly settings: boolean
  readonly api: boolean
  readonly imports: readonly string[]
}

interface ConversationDefinitionAnalysis {
  readonly uses: boolean
  readonly reexports: readonly string[]
}

/** Native Cordis services and their owning DSH package come from the authoring catalog. */
export const CLIENT_SETUP_SERVICE_CAPABILITIES = CLIENT_SERVICES

/** Package edges required by each typed SDK capability come from the same catalog. */
export const CLIENT_SDK_PROVIDERS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(CLIENT_CAPABILITIES).map(([capability, descriptor]) => [capability, descriptor.providers]),
)

export interface ClientSetupServiceAnalysis {
  readonly services: readonly (keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES)[]
  /** Undefined means a dynamic definition prevented a safe static conclusion. */
  readonly inject: readonly string[] | undefined
  /** Services supplied by declarative Client fields such as non-empty locales. */
  readonly autoInject: readonly (keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES)[]
  /** Services implicitly injected by the DSHX runtime when setup has no inject list. */
  readonly runtimeInject: readonly (keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES)[]
  readonly sourceFile: string | undefined
  readonly localeNamespaces: readonly string[] | undefined
  /** Present only for a statically recognized SDK definition; undefined means dynamic uses. */
  readonly sdk?: { readonly uses: readonly string[] | undefined }
}

interface ClientDefinitionSourceAnalysis extends ClientSetupServiceAnalysis {
  readonly reexports: readonly string[]
}

async function sourceFile(specifier: string, importer: string): Promise<string | undefined> {
  const target = resolve(importer, '..', specifier)
  const extension = extname(target)
  if (extension !== '' && !SOURCE_EXTENSIONS.some(candidate => candidate === extension)) return undefined
  if (extension !== '' && !SOURCE_EXTENSIONS.some(item => item === extension)) return undefined
  const candidates =
    extension === ''
      ? [...SOURCE_EXTENSIONS.map(item => `${target}${item}`), ...SOURCE_EXTENSIONS.map(item => resolve(target, `index${item}`))]
      : [target, ...(extension === '.js' ? SOURCE_EXTENSIONS.slice(0, 3).map(item => `${target.slice(0, -3)}${item}`) : [])]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      // Try the next TypeScript/JavaScript source form.
    }
  }
  return undefined
}

const nameOf = (property: ObjectProperty): string | undefined =>
  property.computed && property.key.type === 'Identifier' ? undefined : SourceSyntax.propertyName(property.key)

type SetupFunction = Function | ArrowFunctionExpression

const sourceBindings = ({ source, file }: { source: string; file: string }) => {
  const program = SourceSyntax.parse({ source, file })
  const named = new Map<string, string>()
  const namespaces = new Set<string>()
  const initializers = new Map<string, Expression>()
  const functions = new Map<string, SetupFunction>()
  const imports: string[] = []
  const reexports: string[] = []
  let unknownReexport = false
  let defaultExpression: Expression | undefined
  let defaultLocal: string | undefined
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      if (statement.source.value.startsWith('.')) imports.push(statement.source.value)
      if (statement.source.value === CLIENT_PUBLIC)
        for (const specifier of statement.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name)
          if (specifier.type === 'ImportSpecifier') {
            const imported = SourceSyntax.propertyName(specifier.imported)
            if (imported !== undefined) named.set(specifier.local.name, imported)
          }
        }
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      const declaration = statement.declaration
      if (declaration.type !== 'FunctionDeclaration' && declaration.type !== 'ClassDeclaration' && declaration.type !== 'TSInterfaceDeclaration')
        defaultExpression = declaration
    }
    if (statement.type === 'ExportNamedDeclaration') {
      if (statement.source?.value.startsWith('.')) imports.push(statement.source.value)
      for (const specifier of statement.specifiers) {
        if (SourceSyntax.propertyName(specifier.exported) !== 'default') continue
        if (statement.source !== null) {
          if (SourceSyntax.propertyName(specifier.local) === 'default') reexports.push(statement.source.value)
          else unknownReexport = true
        } else defaultLocal = SourceSyntax.propertyName(specifier.local)
      }
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'VariableDeclaration')
      for (const variable of declaration.declarations) {
        if (variable.id.type === 'Identifier' && variable.init !== null) initializers.set(variable.id.name, variable.init)
      }
    if (declaration?.type === 'FunctionDeclaration' && declaration.id !== null) functions.set(declaration.id.name, declaration)
  }
  if (defaultExpression === undefined && defaultLocal !== undefined) defaultExpression = initializers.get(defaultLocal)
  const importedName = (expression: Expression): string | undefined => {
    if (expression.type === 'Identifier') return named.get(expression.name)
    if (expression.type === 'MemberExpression' && !expression.computed && expression.object.type === 'Identifier' && namespaces.has(expression.object.name))
      return SourceSyntax.propertyName(expression.property)
    return undefined
  }
  const resolveExpression = (input: Expression, seen = new Set<string>()): Expression | undefined => {
    const expression = SourceSyntax.unwrapExpression(input)
    if (expression.type !== 'Identifier') return expression
    if (seen.has(expression.name)) return undefined
    const initializer = initializers.get(expression.name)
    if (initializer === undefined) return undefined
    const next = new Set(seen)
    next.add(expression.name)
    return resolveExpression(initializer, next)
  }
  const resolveFunction = (input: Expression, seen = new Set<string>()): SetupFunction | undefined => {
    const expression = SourceSyntax.unwrapExpression(input)
    if (expression.type === 'ArrowFunctionExpression' || expression.type === 'FunctionExpression') return expression
    if (expression.type !== 'Identifier' || seen.has(expression.name)) return undefined
    const declaration = functions.get(expression.name)
    if (declaration !== undefined) return declaration
    const initializer = initializers.get(expression.name)
    if (initializer === undefined) return undefined
    const next = new Set(seen)
    next.add(expression.name)
    return resolveFunction(initializer, next)
  }
  return { program, named, namespaces, initializers, imports, reexports, unknownReexport, defaultExpression, importedName, resolveExpression, resolveFunction }
}

const sourceCapabilities = (source: string, file: string): SourceCapabilityAnalysis => {
  const bindings = sourceBindings({ source, file })
  let settings = false
  let api = false
  SourceSyntax.visit({
    program: bindings.program,
    visitor: {
      CallExpression(node) {
        if (node.callee.type === 'Super') return
        const name = bindings.importedName(node.callee)
        if (name === 'useSettings') settings = true
        if (name === 'useApi' || name === 'useApiQuery' || name === 'useApiEvent' || name === 'createApiClient') api = true
      },
    },
  })
  return { settings, api, imports: bindings.imports }
}

const declarativeClientDefinition = (source: string, file: string, field: 'conversations' | 'locales'): ConversationDefinitionAnalysis => {
  const bindings = sourceBindings({ source, file })
  const inspect = (input: Expression, seen = new Set<string>()): boolean => {
    const expression = SourceSyntax.unwrapExpression(input)
    if (expression.type === 'Identifier') {
      if (seen.has(expression.name)) return true
      const initializer = bindings.initializers.get(expression.name)
      if (initializer === undefined) return true
      const next = new Set(seen)
      next.add(expression.name)
      return inspect(initializer, next)
    }
    if (expression.type === 'CallExpression' && expression.callee.type !== 'Super') {
      if (!['defineClient', 'defineClientPlugin'].includes(bindings.importedName(expression.callee) ?? '')) return true
      const argument = expression.arguments[0]
      if (argument === undefined) return false
      return argument.type === 'SpreadElement' ? true : inspect(argument, seen)
    }
    if (expression.type !== 'ObjectExpression') return true
    for (const property of expression.properties) {
      if (property.type === 'SpreadElement') {
        if (field === 'conversations') return true
        continue
      }
      const name = nameOf(property)
      if (name === undefined && property.computed && field === 'conversations') return true
      if (name !== field) continue
      const value = SourceSyntax.unwrapExpression(property.value)
      if (value.type === 'ArrayExpression' && value.elements.length === 0) continue
      return true
    }
    return false
  }
  return { uses: bindings.defaultExpression === undefined ? bindings.unknownReexport : inspect(bindings.defaultExpression), reexports: bindings.reexports }
}

const destructuresService = (parameter: ParamPattern, service: string): boolean => {
  if (parameter.type !== 'ObjectPattern') return false
  return parameter.properties.some(property => property.type === 'Property' && SourceSyntax.propertyName(property.key) === service)
}

const functionUsesSetupService = ({
  program,
  declaration,
  service,
}: {
  program: Program
  declaration: SetupFunction
  service: keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES
}): boolean => {
  const parameter = declaration.params[0]
  if (parameter === undefined) return false
  if (destructuresService(parameter, service)) return true
  if (parameter.type !== 'Identifier') return false
  const contextName = parameter.name
  const activeScopes: boolean[] = []
  let used = false
  const enter = (node: SetupFunction): void => {
    if (node === declaration) {
      activeScopes.push(true)
      return
    }
    activeScopes.push(Boolean(activeScopes.at(-1)) && !node.params.some(item => item.type === 'Identifier' && item.name === contextName))
  }
  const leave = (): void => {
    activeScopes.pop()
  }
  SourceSyntax.visit({
    program,
    visitor: {
      FunctionDeclaration: enter,
      'FunctionDeclaration:exit': leave,
      FunctionExpression: enter,
      'FunctionExpression:exit': leave,
      ArrowFunctionExpression: enter,
      'ArrowFunctionExpression:exit': leave,
      MemberExpression(node) {
        if (!activeScopes.at(-1) || node.object.type !== 'Identifier' || node.object.name !== contextName) return
        if (
          (!node.computed && SourceSyntax.propertyName(node.property) === service) ||
          (node.computed && node.property.type === 'Literal' && node.property.value === service)
        )
          used = true
      },
      VariableDeclarator(node) {
        if (!activeScopes.at(-1) || node.init === null) return
        const initializer = SourceSyntax.unwrapExpression(node.init)
        if (initializer.type === 'Identifier' && initializer.name === contextName && destructuresService(node.id, service)) used = true
      },
    },
  })
  return used
}

const clientSetupServicesInSource = (source: string, file: string): ClientDefinitionSourceAnalysis => {
  const bindings = sourceBindings({ source, file })
  const absent = {
    services: [],
    inject: undefined,
    autoInject: [],
    runtimeInject: [],
    localeNamespaces: undefined,
    sourceFile: undefined,
    reexports: bindings.reexports,
  }
  if (bindings.defaultExpression === undefined) return absent
  const defaultExpression = bindings.resolveExpression(bindings.defaultExpression)
  if (defaultExpression?.type !== 'CallExpression' || defaultExpression.callee.type === 'Super') return absent
  const name = bindings.importedName(defaultExpression.callee)
  if (name !== 'defineClient' && name !== 'defineClientPlugin') return absent
  const argument = defaultExpression.arguments[0]
  if (argument === undefined) return absent
  const definition = argument.type === 'SpreadElement' ? undefined : bindings.resolveExpression(argument)
  if (definition?.type !== 'ObjectExpression') return { ...absent, sourceFile: file }
  const properties = definition.properties
  const spreadIndex = properties.reduce((last, property, index) => (property.type === 'SpreadElement' ? index : last), -1)
  const propertyAt = (name: string): ObjectProperty | undefined => {
    const index = properties.reduce((last, property, index) => (property.type === 'Property' && nameOf(property) === name ? index : last), -1)
    if (index < 0 || spreadIndex > index) return undefined
    const property = properties[index]
    return property?.type === 'Property' ? property : undefined
  }
  const arrayField = (name: string): readonly string[] | undefined => {
    const property = propertyAt(name)
    if (property === undefined) return spreadIndex < 0 ? [] : undefined
    const value = bindings.resolveExpression(property.value)
    if (value?.type !== 'ArrayExpression') return undefined
    const values: string[] = []
    for (const element of value.elements) {
      if (element === null || element.type === 'SpreadElement') return undefined
      const text = SourceSyntax.stringValue(element)
      if (text === undefined) return undefined
      values.push(text)
    }
    return values
  }
  const inject = arrayField('inject')
  const localeProperty = propertyAt('locales')
  const locales = localeProperty === undefined ? undefined : bindings.resolveExpression(localeProperty.value)
  const autoInject: Array<keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES> = locales?.type === 'ArrayExpression' && locales.elements.length > 0 ? ['locale'] : []
  const localeNamespaces: string[] = []
  let knownLocaleNamespaces = localeProperty === undefined && spreadIndex < 0
  if (locales?.type === 'ArrayExpression') {
    knownLocaleNamespaces = true
    for (const element of locales.elements) {
      if (element === null || element.type === 'SpreadElement') {
        knownLocaleNamespaces = false
        break
      }
      const namespace = localeNamespace({ expression: element, bindings })
      if (namespace === undefined) {
        knownLocaleNamespaces = false
        break
      }
      localeNamespaces.push(namespace)
    }
  }
  const setupProperty = propertyAt('setup')
  const setup = setupProperty === undefined ? undefined : bindings.resolveFunction(setupProperty.value)
  // SAFETY: Object.keys of this module-level const map yields exactly its declared keys.
  const services = (Object.keys(CLIENT_SETUP_SERVICE_CAPABILITIES) as Array<keyof typeof CLIENT_SETUP_SERVICE_CAPABILITIES>).filter(
    service => setup !== undefined && functionUsesSetupService({ program: bindings.program, declaration: setup, service }),
  )
  const runtimeInject = setup !== undefined && inject?.length === 0 ? CLIENT_DEFAULT_SERVICES : []
  const result: ClientDefinitionSourceAnalysis = {
    services,
    inject,
    autoInject,
    runtimeInject,
    sourceFile: file,
    localeNamespaces: knownLocaleNamespaces ? localeNamespaces : undefined,
    reexports: bindings.reexports,
  }
  if (name === 'defineClientPlugin') return { ...result, sdk: { uses: arrayField('uses') } }
  return result
}

/** Conservative source-level capability preview; the post-tree-shake build check is authoritative. */
const clientUsesSettings = async (entry: string, root: string): Promise<boolean> => {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const analysis = sourceCapabilities(source, file)
    if (analysis.settings) return true
    for (const request of analysis.imports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return false
}

/** Conservative source-level preview for retained API hook capability. */
const clientUsesApi = async (entry: string, root: string): Promise<boolean> => {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const analysis = sourceCapabilities(source, file)
    if (analysis.api) return true
    for (const request of analysis.imports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return false
}

/** Conservative preview of an explicit defineClient({ conversations }) contribution. */
const clientUsesConversationComponents = async (entry: string, root: string): Promise<boolean> => {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const analysis = declarativeClientDefinition(source, file, 'conversations')
    if (analysis.uses) return true
    for (const request of analysis.reexports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return false
}

/** Conservative preview of an explicit defineClient({ locales }) contribution. */
const clientUsesLocales = async (entry: string, root: string): Promise<boolean> => {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const analysis = declarativeClientDefinition(source, file, 'locales')
    if (analysis.uses) return true
    for (const request of analysis.reexports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return false
}

/** Inspect direct optional Cordis-service use in defineClient({ setup(ctx) }). */
const clientSetupServices = async (entry: string, root: string): Promise<ClientSetupServiceAnalysis> => {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const analysis = clientSetupServicesInSource(source, file)
    if (analysis.sourceFile !== undefined) return analysis
    for (const request of analysis.reexports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return { services: [], inject: undefined, autoInject: [], runtimeInject: [], localeNamespaces: undefined, sourceFile: undefined }
}

const localeNamespace = ({ expression, bindings }: { expression: Expression; bindings: ReturnType<typeof sourceBindings> }): string | undefined => {
  const call = bindings.resolveExpression(expression)
  if (call?.type !== 'CallExpression' || call.callee.type === 'Super') return undefined
  const factory = bindings.importedName(call.callee)
  if (factory !== 'defineLocale' && factory !== 'declareLocaleNamespace') return undefined
  const argument = call.arguments[0]
  if (argument === undefined || argument.type === 'SpreadElement') return undefined
  return SourceSyntax.stringValue(bindings.resolveExpression(argument) ?? argument)
}

const clientLocaleNamespaces = async (entry: string, root: string): Promise<readonly string[] | undefined> => {
  const analysis = await clientSetupServices(entry, root)
  if (analysis.localeNamespaces !== undefined) return analysis.localeNamespaces
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || visited.has(file)) continue
    visited.add(file)
    const source = await readFile(file, 'utf8').catch(() => undefined)
    if (source === undefined) continue
    const bindings = sourceBindings({ source, file })
    const claimed: string[] = []
    for (const initializer of bindings.initializers.values()) {
      const namespace = localeNamespace({ expression: initializer, bindings })
      if (namespace !== undefined) claimed.push(namespace)
    }
    if (claimed.length > 0) return claimed
    for (const request of bindings.imports) {
      const target = await sourceFile(request, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return undefined
}

export class ClientCapabilityAnalysis {
  static readonly usesSettings = clientUsesSettings
  static readonly usesApi = clientUsesApi
  static readonly usesConversationComponents = clientUsesConversationComponents
  static readonly usesLocales = clientUsesLocales
  static readonly setupServices = clientSetupServices
  static readonly localeNamespaces = clientLocaleNamespaces
}
