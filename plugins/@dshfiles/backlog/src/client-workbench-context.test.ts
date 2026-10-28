import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('decorates the explicit Workbench renderer with the Backlog owner context, like the native main renderer', () => {
  const source = readFileSync(new URL('./client-entry.tsx', import.meta.url), 'utf8')
  // Workbench renders explicit contributions directly rather than through the decorated main slot.
  // Guard the imperative registration boundary: useApi(backlogApi) needs its owner's decorator on reload.
  expect(source).toMatch(/workbenchPanels\(\)\.register\(\{[^}]*component:\s*decorate\(PanelView\)/u)
  expect(source).toMatch(/name:\s*'main',\s*key:\s*PANEL_ID\s*\},\s*decorate\(PanelView\)/u)
})
