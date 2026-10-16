import { parseSync, Visitor, type Expression, type Program, type ObjectProperty, type PropertyKey, type VisitorObject } from 'oxc-parser'

const parseSource = ({ file, source }: { file: string; source: string }): Program => {
  const result = parseSync(file, source, { preserveParens: true })
  if (result.errors.length > 0) throw new Error(result.errors.map(error => error.message).join('\n'))
  return result.program
}

const visitSource = ({ program, visitor }: { program: Program; visitor: VisitorObject }): void => new Visitor(visitor).visit(program)

const propertyName = (key: PropertyKey): string | undefined => {
  if (key.type === 'Identifier') return key.name
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) return String(key.value)
  return undefined
}

const stringValue = (expression: Expression | undefined): string | undefined => {
  if (expression?.type === 'Literal' && typeof expression.value === 'string') return expression.value
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) return expression.quasis[0]?.value.cooked ?? undefined
  return undefined
}

const unwrapExpression = (expression: Expression): Expression => {
  if (
    expression.type === 'ParenthesizedExpression' ||
    expression.type === 'TSAsExpression' ||
    expression.type === 'TSSatisfiesExpression' ||
    expression.type === 'TSNonNullExpression' ||
    expression.type === 'TSTypeAssertion'
  ) {
    return unwrapExpression(expression.expression)
  }
  return expression
}

const objectProperty = ({ expression, name }: { expression: Expression; name: string }): ObjectProperty | undefined => {
  if (expression.type !== 'ObjectExpression') return undefined
  return expression.properties.find((property): property is ObjectProperty => property.type === 'Property' && propertyName(property.key) === name)
}

const defaultCall = ({ program, name }: { program: Program; name: string }) => {
  for (const statement of program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue
    const expression = statement.declaration
    if (expression.type === 'CallExpression' && expression.callee.type === 'Identifier' && expression.callee.name === name) return expression
  }
  return undefined
}

const lastImportEnd = (program: Program): number => program.body.filter(statement => statement.type === 'ImportDeclaration').at(-1)?.end ?? 0

export class SourceSyntax {
  static readonly parse = parseSource
  static readonly visit = visitSource
  static readonly propertyName = propertyName
  static readonly stringValue = stringValue
  static readonly unwrapExpression = unwrapExpression
  static readonly objectProperty = objectProperty
  static readonly defaultCall = defaultCall
  static readonly lastImportEnd = lastImportEnd
}
