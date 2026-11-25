import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

test('the header chip entry waits for its slot, so a missing slot does not stop setup', () => {
  // A bare `register` throws "slot … is not declared" when the owner of the header did not load (round four, S6).
  expect(read('client.tsx')).toMatch(/ctx\.slots\.inject\('conversation\.session\.header\.actions', \(\) => \{\s+let withdraw/u)
})

test('an idle board draws no "Nothing running" chip', () => {
  expect(read('locales.ts')).not.toContain('nothingRunning')
})
