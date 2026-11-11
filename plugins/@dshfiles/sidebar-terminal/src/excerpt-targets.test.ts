import { afterEach, expect, it } from 'vitest'
import { registerTerminalExcerptTarget, terminalExcerptTargetAt, type TerminalExcerptTarget } from './native/client/excerpt-targets.ts'

const releases: (() => void)[] = []

const target = (node: Node, onAttach: () => void = () => {}): TerminalExcerptTarget => ({
  contains: candidate => candidate !== null && node.contains(candidate),
  selected: () => true,
  attach: onAttach,
})

const registered = (node: Node, onAttach?: () => void): TerminalExcerptTarget => {
  const value = target(node, onAttach)
  releases.push(registerTerminalExcerptTarget(value))
  return value
}

afterEach(() => {
  for (const release of releases.splice(0)) release()
})

it('resolves the mounted terminal that owns the shortcut target', () => {
  const first = document.createElement('div')
  const second = document.createElement('div')
  const value = registered(second)
  expect(terminalExcerptTargetAt(second)).toBe(value)
  expect(terminalExcerptTargetAt(first)).toBeUndefined()
  expect(terminalExcerptTargetAt(null)).toBeUndefined()
})

it('forgets a terminal once its screen unmounts', () => {
  const node = document.createElement('div')
  const onAttach = () => {}
  registered(node, onAttach)
  expect(terminalExcerptTargetAt(node)).toBeDefined()
  for (const release of releases.splice(0)) release()
  expect(terminalExcerptTargetAt(node)).toBeUndefined()
})

it('attaches through the screen that owns the selection', () => {
  const node = document.createElement('div')
  let attached = 0
  registered(node, () => {
    attached += 1
  })
  terminalExcerptTargetAt(node)?.attach()
  expect(attached).toBe(1)
})
