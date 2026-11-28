import { bootImports } from '@dshfiles/plugin-ui/testing/boot-imports'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

test('page boot does not parse the diff renderer; an edit card loads it when a hunk opens', () => {
  // A string, not `new URL(...)`: this package tests under jsdom, whose URL class Node's fileURLToPath rejects.
  const root = dirname(fileURLToPath(import.meta.url))
  const boot = bootImports(join(root, 'client.tsx'))
  expect(boot.has('diff-tool-card.tsx')).toBe(true)
  // The renderer (@pierre/diffs with shiki) comes from the kit's diff module; collapsed rows only parse.
  const renderer = /from\s+['"]@dshfiles\/plugin-ui\/diff['"]/u
  expect([...boot].filter(file => renderer.test(readFileSync(join(root, file), 'utf8')))).toEqual([])
})
