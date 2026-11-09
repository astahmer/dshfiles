import { describe, expect, it } from 'vitest'
import { PackageJsonChangesModel } from '../src/package-json-changes.js'

const fileDiff = (path: string, body: string): string => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
${body}`

const named = fileDiff(
  'plugins/x/package.json',
  `@@ -3,12 +3,12 @@
   "scripts": {
-    "build": "tsc",
+    "build": "dshx build",
   },
   "dependencies": {
-    "effect": "4.0.0",
+    "effect": "4.1.0",
-    "lodash": "^4.17.0",
+    "zod": "catalog:",
     "react": "19.0.0"
   },
   "devDependencies": {
+    "vitest": "3.2.4"
   }
`,
)

describe('PackageJsonChangesModel.read', () => {
  it('reads added, removed and updated dependencies of named sections, and counts the other changed lines', () => {
    const patch = `${fileDiff('src/a.ts', '@@ -1 +1 @@\n-"react": "18.0.0"\n+"react": "19.0.0"\n')}${named}`
    expect(PackageJsonChangesModel.read(patch)).toEqual([
      {
        path: 'plugins/x/package.json',
        confident: true,
        otherLines: 2,
        changes: [
          { name: 'effect', section: 'dependencies', kind: 'updated', before: '4.0.0', after: '4.1.0' },
          { name: 'lodash', section: 'dependencies', kind: 'removed', before: '^4.17.0', after: null },
          { name: 'zod', section: 'dependencies', kind: 'added', before: null, after: 'catalog:' },
          { name: 'vitest', section: 'devDependencies', kind: 'added', before: null, after: '3.2.4' },
        ],
      },
    ])
  })

  it('lists a version bump in a hunk that starts mid-section, but not as confident', () => {
    const patch = fileDiff(
      'package.json',
      `@@ -40,3 +40,3 @@\n     "a": "1.0.0",\n-    "b": "^1.0.0",\n+    "b": "^2.0.0",\n-    "description": "old"\n+    "description": "new"\n`,
    )
    expect(PackageJsonChangesModel.read(patch)).toEqual([
      { path: 'package.json', confident: false, otherLines: 2, changes: [{ name: 'b', section: null, kind: 'updated', before: '^1.0.0', after: '^2.0.0' }] },
    ])
  })

  it('does not take a sibling of a closed nested object for a dependency', () => {
    const patch = fileDiff(
      'package.json',
      `@@ -10,6 +10,6 @@\n     "overrides": {\n       "a": "1.0.0"\n     },\n-    "b": "^1.0.0"\n+    "b": "^2.0.0"\n   }\n`,
    )
    expect(PackageJsonChangesModel.read(patch)).toEqual([])
  })

  it('keeps the text of an ambiguous engines bump: its row is not confident', () => {
    const patch = fileDiff('package.json', `@@ -20,3 +20,3 @@\n-    "node": ">=18"\n+    "node": ">=20"\n   },\n`)
    expect(PackageJsonChangesModel.read(patch).every(file => !file.confident)).toBe(true)
  })

  it('skips top-level version fields and a package.json whose dependencies did not change', () => {
    const only = fileDiff('package.json', `@@ -1,3 +1,3 @@\n {\n-  "version": "1.0.0",\n+  "version": "1.1.0",\n`)
    expect(PackageJsonChangesModel.read(only)).toEqual([])
    expect(PackageJsonChangesModel.read(only.replace(' {\n', ''))).toEqual([])
    expect(PackageJsonChangesModel.read('')).toEqual([])
  })

  it('reads a deleted package.json from its old path', () => {
    const patch = `diff --git a/old/package.json b/old/package.json\n--- a/old/package.json\n+++ /dev/null\n@@ -1,5 +0,0 @@\n-{\n-  "dependencies": {\n-    "effect": "4.0.0"\n-  }\n-}\n`
    expect(PackageJsonChangesModel.read(patch)).toEqual([
      {
        path: 'old/package.json',
        confident: true,
        otherLines: 0,
        changes: [{ name: 'effect', section: 'dependencies', kind: 'removed', before: '4.0.0', after: null }],
      },
    ])
  })
})
