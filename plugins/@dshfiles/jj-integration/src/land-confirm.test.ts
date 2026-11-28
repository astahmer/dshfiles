import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// jj-integration renders no DOM in its tests, so this reads the components: every Land button opens the one
// confirmation (LandConfirmDialog) and only the dialog's confirm lands.
const source = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

describe('every Land asks the same question', () => {
  it('the turn-end offer opens the header confirmation instead of landing on click', () => {
    const offer = source('land-preview.tsx')
    expect(offer).toMatch(/<LandConfirmDialog[\s\S]*?onConfirm=\{props\.onLand\}/u)
    expect(offer).not.toMatch(/onClick=\{props\.onLand\}/u)
  })

  it('the header control lands only from the dialog', () => {
    const header = source('thread-workspace-control.tsx')
    expect(header).toMatch(/<LandConfirmDialog[\s\S]*?onConfirm=\{\(\) => \{\s*setLanding\(true\)\s*rebase\.mutate/u)
    expect(header.match(/rebase\.mutate\(/gu)).toHaveLength(1)
  })
})
