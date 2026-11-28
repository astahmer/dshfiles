import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { kitDemos } from './demos/kit.js'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const source = readFileSync(join(process.cwd(), 'src/demos/kit.tsx'), 'utf8')

describe('colour roles demo', () => {
  it('is a wide Kit card', () => {
    const demo = kitDemos.find(candidate => candidate.id === 'kit-colour-roles')
    expect(demo?.title).toBe('Colour roles')
    expect(demo?.wide).toBe(true)
  })

  it('draws a literal swatch for every role, identity and data token, and each health', () => {
    const roles = ['status-needs-you', 'status-failed', 'status-ready', 'status-working', 'status-idle', 'status-done', 'control-on', 'selected-wash', 'wash-needs-you', 'wash-failed', 'attention-tint', 'danger-tint']
    for (let n = 1; n <= 8; n += 1) roles.push(`identity-${n}`)
    for (let n = 1; n <= 6; n += 1) roles.push(`data-${n}`)
    for (const role of roles) expect(source, role).toContain(`'dshx:bg-${role}'`)
    expect(source).toContain("(['ok', 'limited', 'down', 'off'] as const).map(health =>")
    expect(source).toContain('<HealthDot health={health} />')
  })

  it('shows every project tone as a ProjectMark, at both sizes, beside a muted name', () => {
    expect(source).toContain("import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'")
    expect(source.match(/const projectNames = \[([^\]]*)\]/)?.[1]?.split(',').filter(name => name.trim().length > 0)).toHaveLength(6)
    expect(source).toContain('<ProjectMark name={name} tone={tone} />')
    expect(source).toContain('<ProjectMark name={name} tone={tone} size="dense" />')
  })
})
