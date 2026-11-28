import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')

/** The class string of every `<button` in a component source. */
const buttonClasses = (name: string): readonly string[] =>
  [...source(name).matchAll(/<button\b[\s\S]*?className=(?:"([^"]*)"|\{cn\(\s*'([^']*)')/g)].map(match => match[1] ?? match[2] ?? '')

describe('the turn summary row on a touch screen', () => {
  it('gives every control a 44px target on a coarse pointer', () => {
    const controls = ['turn-summary-line.tsx', 'turn-walkthrough.tsx', 'turn-file-chips.tsx'].flatMap(name =>
      buttonClasses(name).map(classes => ({ name, classes })),
    )
    // The list toggle, the failed-commands toggle, the walkthrough toggle, a file chip and "+N more".
    expect(controls.length).toBeGreaterThanOrEqual(5)
    const inline = controls.filter(control => !control.classes.includes('dshx:font-mono dshx:hover:text-foreground dshx:hover:underline'))
    for (const control of inline) expect(control.classes, control.name).toMatch(/dshx:pointer-coarse:(min-h|h)-11\b/)
  })
})
