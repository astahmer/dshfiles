import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { Expression } from 'oxc-parser'
import { SourceSyntax } from '../../project/syntax.js'
import { CLIENT_SLOT_REFERENCES } from 'create-dshx/slot-capabilities'

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'] as const

export const SHIPPED_SLOT_OCCUPANTS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  CLIENT_SLOT_REFERENCES.filter(slot => slot.shippedOccupants.length > 0).map(slot => [slot.name, new Set(slot.shippedOccupants)]),
)

async function sourceFile(specifier: string, importer: string): Promise<string | undefined> {
  const target = resolve(importer, '..', specifier)
  const extension = extname(target)
  if (extension !== '' && !SOURCE_EXTENSIONS.some(candidate => candidate === extension)) return undefined
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

export interface SlotRegistration {
  readonly slot: string
  readonly id?: string
  readonly key?: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly order?: number
  readonly priority?: number
  readonly via: 'native-register' | 'sdk-ui' | 'sdk-panel' | 'sdk-composer' | 'sdk-define-slot'
}

function numericValue(expression: Expression): number | undefined {
  if (expression.type === 'Literal') return typeof expression.value === 'number' ? expression.value : undefined
  if (expression.type !== 'UnaryExpression') return undefined
  const operand = SourceSyntax.unwrapExpression(expression.argument)
  if (operand.type !== 'Literal' || typeof operand.value !== 'number') return undefined
  if (expression.operator === '-') return -operand.value
  if (expression.operator === '+') return operand.value
  return undefined
}

const memberPath = (expression: Expression): string | undefined => {
  const value = SourceSyntax.unwrapExpression(expression)
  if (value.type === 'Identifier') return value.name
  if (value.type !== 'MemberExpression') return undefined
  const object = memberPath(value.object)
  const property = SourceSyntax.propertyName(value.property)
  return object === undefined || property === undefined ? undefined : `${object}.${property}`
}

const objectValue = (expression: Expression | undefined, name: string): Expression | undefined => {
  if (expression === undefined) return undefined
  const value = SourceSyntax.unwrapExpression(expression)
  if (value.type !== 'ObjectExpression') return undefined
  for (const property of value.properties) {
    if (property.type === 'Property' && SourceSyntax.propertyName(property.key) === name) return SourceSyntax.unwrapExpression(property.value)
  }
  return undefined
}

const objectString = (expression: Expression | undefined, name: string, strings: ReadonlyMap<string, string>): string | undefined => {
  const value = objectValue(expression, name)
  if (value === undefined) return undefined
  const unwrapped = SourceSyntax.unwrapExpression(value)
  if (unwrapped.type === 'Identifier') return strings.get(unwrapped.name)
  return SourceSyntax.stringValue(unwrapped)
}

const objectPriority = (expression: Expression | undefined): number | undefined => {
  const value = objectValue(expression, 'priority')
  return value === undefined ? undefined : numericValue(value)
}

const objectOrder = (expression: Expression | undefined): number | undefined => {
  const value = objectValue(expression, 'order')
  return value === undefined ? undefined : numericValue(value)
}

const sourceLocation = (source: string, offset: number) => {
  const before = source.slice(0, offset)
  const lastNewline = before.lastIndexOf('\n')
  return { line: before.split('\n').length, column: offset - lastNewline }
}

const registrationsIn = (source: string, file: string): SlotRegistration[] => {
  const program = SourceSyntax.parse({ source, file })
  const defineSlotNames = new Set(['defineSlot'])
  const strings = new Map<string, string>()
  for (const statement of program.body) {
    if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && specifier.imported.name === 'defineSlot') {
          defineSlotNames.add(specifier.local.name)
        }
      }
    }
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue
    for (const variable of declaration.declarations) {
      if (variable.id.type !== 'Identifier' || variable.init === null) continue
      const value = SourceSyntax.stringValue(SourceSyntax.unwrapExpression(variable.init))
      if (value !== undefined) strings.set(variable.id.name, value)
    }
  }
  const found: SlotRegistration[] = []
  const record = ({
    slot,
    id,
    key,
    order,
    priority,
    offset,
    via,
  }: {
    readonly slot: string | undefined
    readonly id?: string | undefined
    readonly key?: string | undefined
    readonly order?: number | undefined
    readonly priority?: number | undefined
    readonly offset: number
    readonly via: SlotRegistration['via']
  }): void => {
    if (slot === undefined) return
    const location = sourceLocation(source, offset)
    found.push({
      slot,
      ...(id !== undefined && { id }),
      ...(key !== undefined && { key }),
      file,
      ...location,
      ...(order !== undefined && { order }),
      ...(priority !== undefined && { priority }),
      via,
    })
  }

  SourceSyntax.visit({
    program,
    visitor: {
      CallExpression(current) {
        const name = memberPath(current.callee)
        if (name === undefined) return
        const first = current.arguments[0]
        const firstValue = first === undefined || first.type === 'SpreadElement' ? undefined : SourceSyntax.unwrapExpression(first)
        const knownRegister =
          name.endsWith('.slots.register') || name.endsWith('.ui.register') || name.endsWith('.panels.register') || name.endsWith('.sidebar.register')
        if (knownRegister && firstValue !== undefined) {
          const slot = objectString(firstValue, 'name', strings)
          const id = objectString(firstValue, 'id', strings)
          const key = objectString(firstValue, 'key', strings)
          const via = name.endsWith('.ui.register') ? 'sdk-ui' : 'native-register'
          record({ slot, id, key, order: objectOrder(firstValue), priority: objectPriority(firstValue), offset: current.start, via })
          if (name.endsWith('.panels.register') || name.endsWith('.sidebar.register')) {
            const panelId = objectString(firstValue, 'id', strings)
            record({ slot: 'main', key: panelId, order: objectOrder(firstValue), offset: current.start, via: 'sdk-panel' })
            record({ slot: 'sidebar.panellist', id: panelId, order: objectOrder(firstValue), offset: current.start, via: 'sdk-panel' })
          }
          return
        }
        if (name.endsWith('.registerAction') && name.includes('.composer.')) {
          const actionId = objectString(firstValue, 'id', strings)
          const placement = objectString(firstValue, 'placement', strings)
          record({
            slot: placement === 'right' ? 'conversation.input.right' : 'conversation.input.left',
            id: actionId,
            order: objectOrder(firstValue),
            offset: current.start,
            via: 'sdk-composer',
          })
          return
        }
        const callee = SourceSyntax.unwrapExpression(current.callee)
        if (callee.type !== 'Identifier' || !defineSlotNames.has(callee.name)) return
        const slot = SourceSyntax.stringValue(firstValue)
        const options = current.arguments[1]
        const optionsValue = options === undefined || options.type === 'SpreadElement' ? undefined : SourceSyntax.unwrapExpression(options)
        record({
          slot,
          id: objectString(optionsValue, 'id', strings),
          key: objectString(optionsValue, 'key', strings),
          order: objectOrder(optionsValue),
          priority: objectPriority(optionsValue),
          offset: current.start,
          via: 'sdk-define-slot',
        })
      },
    },
  })
  return found
}

export async function clientSlotRegistrations(entry: string, root: string): Promise<readonly SlotRegistration[]> {
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  const found: SlotRegistration[] = []
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
    const parsed = SourceSyntax.parse({ source, file })
    found.push(...registrationsIn(source, file))
    for (const statement of parsed.body) {
      if (statement.type !== 'ImportDeclaration' || !statement.source.value.startsWith('.')) continue
      const target = await sourceFile(statement.source.value, file)
      if (target !== undefined && !visited.has(target)) pending.push(target)
    }
  }
  return found
}

export function slotOccupancyConflicts(
  registrations: readonly SlotRegistration[],
  occupants: ReadonlyMap<string, ReadonlySet<string>> = SHIPPED_SLOT_OCCUPANTS,
): readonly (SlotRegistration & { readonly occupant: string })[] {
  return registrations.flatMap(registration => {
    if (registration.priority !== undefined) return []
    const identity = registration.id ?? registration.key
    const claimed = occupants.get(registration.slot)
    if (claimed === undefined) return []
    if (identity === undefined) return [...claimed].map(occupant => ({ ...registration, occupant }))
    return claimed?.has(identity) === true ? [{ ...registration, occupant: identity }] : []
  })
}
