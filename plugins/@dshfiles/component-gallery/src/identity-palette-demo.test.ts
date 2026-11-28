import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kitDemos } from './demos/kit.js'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const source = readFileSync(join(process.cwd(), 'src/demos/kit.tsx'), 'utf8')

describe('identity palette demo (round eight)', () => {
  it('is a Kit card naming the PalettePicker import', () => {
    const demo = kitDemos.find(candidate => candidate.id === 'kit-identity-palette')
    expect(demo?.title).toBe('Identity palette')
    expect(demo?.source).toBe("import { PalettePicker } from '@dshfiles/plugin-ui/components/palette-picker'")
  })

  it('shows a project picker on its default slot, a tag picker with a choice, and every slot under the theme’s name', () => {
    expect(source).toContain('<PalettePicker label="Project colour" value={slot} defaultSlot={fallback} onChange={setSlot} />')
    expect(source).toContain('<PalettePicker label="Tag colour" size="sm" value={tagSlot} onChange={setTagSlot} />')
    expect(source).toContain('<ProjectMark name="billing-api" tone={tone} />')
    expect(source).toContain('const names = useIdentityPaletteNames()')
    expect(source).toContain('{n} · {identitySlotName(n, names)}')
  })
})
