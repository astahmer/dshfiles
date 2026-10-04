import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import ts from 'typescript'

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs'] as const

/**
 * Slot entries a shipped DSH Client already occupies.
 *
 * A `list` slot addresses entries by `id`, and two occupants of one id render as
 * a single dock whose loser is dropped without an error. A plugin that wants to
 * *replace* a shipped dock needs DSH's shadowing mechanism; a plugin that wants
 * to sit beside one needs its own id. Either way the collision is worth failing
 * the build over, because the symptom is an affordance that is simply absent.
 */
export const SHIPPED_SLOT_OCCUPANTS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['conversation.input.dock', new Set(['todo', 'queue'])],
  ['sidebar.footer.action', new Set()],
  ['sidebar.panellist', new Set(['plugins'])],
  ['main', new Set()],
])

async function sourceFile(specifier: string, importer: string): Promise<string | undefined> {
  const target = resolve(importer, '..', specifier)
  const extension = extname(target)
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

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression))
    return unwrap(expression.expression)
  return expression
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text
  return undefined
}

/** One `ctx.slots.register({ name, id }, …)` call, with both keys read from literals. */
export interface SlotRegistration {
  readonly slot: string
  readonly id: string
  readonly file: string
}

function registrationsIn(source: string, file: string): SlotRegistration[] {
  const node = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: SlotRegistration[] = []
  const visit = (current: ts.Node): void => {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === 'register' &&
      current.arguments[0] !== undefined
    ) {
      const options = unwrap(current.arguments[0])
      if (ts.isObjectLiteralExpression(options)) {
        let slot: string | undefined
        let id: string | undefined
        for (const property of options.properties) {
          if (ts.isSpreadAssignment(property)) continue
          const name = propertyName(property.name)
          if (name === undefined) continue
          if (name !== 'name' && name !== 'id') continue
          const initializer = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : undefined
          if (initializer === undefined || !ts.isStringLiteralLike(initializer)) continue
          if (name === 'name') slot = initializer.text
          else id = initializer.text
        }
        if (slot !== undefined && id !== undefined) found.push({ slot, id, file })
      }
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return found
}

/**
 * Every Slot registration reachable from a Client entry, following its relative
 * imports. Returns an empty list when the entry cannot be read, so an unreadable
 * project stays the build's existing error rather than a new one here.
 */
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
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    found.push(...registrationsIn(source, file))
    for (const statement of parsed.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.startsWith('.')
      ) {
        const target = await sourceFile(statement.moduleSpecifier.text, file)
        if (target !== undefined && !visited.has(target)) pending.push(target)
      }
    }
  }
  return found
}

/** Registrations that claim a cell a shipped package already occupies. */
export function slotOccupancyConflicts(
  registrations: readonly SlotRegistration[],
  occupants: ReadonlyMap<string, ReadonlySet<string>> = SHIPPED_SLOT_OCCUPANTS,
): readonly (SlotRegistration & { readonly occupant: string })[] {
  return registrations.flatMap(registration => {
    const claimed = occupants.get(registration.slot)
    return claimed?.has(registration.id) === true ? [{ ...registration, occupant: registration.id }] : []
  })
}
