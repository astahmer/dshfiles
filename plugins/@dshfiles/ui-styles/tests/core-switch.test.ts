/**
 * Round five K10: every switch draws its on state in `control-on` (the accent), the core Plugins page's too. The core
 * switch is the Host primitives `Switch`, a `button[role=switch]` whose CSS-module class fills `[aria-checked='true']`
 * with the ink. ui-styles recolours it with one rule keyed on the role and `aria-checked`; this guard fails when a DSH
 * bump stops keying the Host switch off `aria-checked`, or when the rule would no longer out-rank the module rule.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(join(process.cwd(), 'package.json'))
const dsh = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const primitives = dirname(dsh.resolve('@deepseek-ai/dsh-client-ui-primitives/package.json'))
const hostSheet = readFileSync(join(primitives, 'lib/Switch.module.css'), 'utf8')
const hostScript = readFileSync(join(primitives, 'lib/index.js'), 'utf8')
const client = readFileSync(join(process.cwd(), 'src/client.css'), 'utf8')

const RULE = "button[role='switch'][aria-checked='true']:not([data-slot])"

describe('core switch on state (round five K10)', () => {
  it('still marks the Host switch on state with role=switch and aria-checked', () => {
    expect(hostScript).toMatch(/role: "switch",\s*"aria-checked": checked/u)
    expect(hostSheet).toContain(".switch[aria-checked='true'] {")
  })

  it('fills a checked core switch with the accent, at a higher specificity than the Host module rule', () => {
    const at = client.indexOf(`${RULE} {`)
    expect(at).toBeGreaterThan(-1)
    expect(client.slice(at, client.indexOf('}', at))).toContain('background: var(--dsw-alias-state-business-primary);')
    // `.switch[aria-checked='true']` is (0,2,0); the rule is a type, two attributes and a :not() attribute: (0,3,1).
    expect(RULE.match(/\[/g)).toHaveLength(3)
    // Unlayered, like the Host module sheet: a layered rule would lose whatever its specificity.
    expect(client.slice(0, at)).not.toMatch(/@layer[^{]*\{[^}]*$/u)
  })
})
