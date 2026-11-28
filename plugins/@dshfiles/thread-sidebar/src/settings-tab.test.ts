import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const settingsTab = readFileSync(fileURLToPath(new URL('./settings-tab.tsx', import.meta.url)), 'utf8')

test('a choice between two values is the kit segmented control, not two buttons with a black one', () => {
  expect(settingsTab).toContain('<ToggleGroup')
  expect(settingsTab).not.toMatch(/variant=\{[^}]*\? 'default' : 'outline'\}/u)
  expect(settingsTab).not.toMatch(/variant=\{[^}]*\? 'outline' : 'default'\}/u)
})
