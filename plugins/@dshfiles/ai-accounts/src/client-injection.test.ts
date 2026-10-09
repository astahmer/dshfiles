import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('declares the credential remote accessed during fresh client boot', () => {
  const source = ts.createSourceFile(
    'client.tsx',
    readFileSync(new URL('./client.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const dependencies: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineClientPlugin') {
      const definition = node.arguments[0]
      if (definition !== undefined && ts.isObjectLiteralExpression(definition)) {
        for (const property of definition.properties) {
          if (!ts.isPropertyAssignment(property) || property.name.getText(source) !== 'inject') continue
          if (!ts.isArrayLiteralExpression(property.initializer)) continue
          for (const dependency of property.initializer.elements) {
            if (ts.isStringLiteral(dependency)) dependencies.push(dependency.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(dependencies).toContain('remote')
  expect(dependencies).toContain('remote.credentials')
})
