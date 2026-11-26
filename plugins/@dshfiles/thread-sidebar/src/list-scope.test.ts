import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ThreadListScope } from './list-scope.js'

describe('phone thread list scope button (council round 10 B1)', () => {
  it('reads "All" at the default scope and names only the narrowed parts, view first', () => {
    expect(ThreadListScope.label({ view: null, project: null, all: 'All' })).toBe('All')
    expect(ThreadListScope.label({ view: 'Needs you', project: null, all: 'All' })).toBe('Needs you')
    expect(ThreadListScope.label({ view: null, project: 'billing-api', all: 'All' })).toBe('billing-api')
    expect(ThreadListScope.label({ view: 'Needs you', project: 'billing-api', all: 'All' })).toBe('Needs you · billing-api')
  })

  it('marks a narrowed scope (a view, a filter or a project) and not the default', () => {
    expect(ThreadListScope.narrowed({ view: null, project: null, all: 'All' })).toBe(false)
    expect(ThreadListScope.narrowed({ view: 'Working', project: null, all: 'All' })).toBe(true)
    expect(ThreadListScope.narrowed({ view: null, project: 'Unassigned', all: 'All' })).toBe(true)
  })

  it('draws the list Filter menu into the search row on a phone, with the project in the menu and no project row', () => {
    const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')
    // One menu, two seats: inline beside the project picker on a desktop, portalled into the shell's seat on a phone.
    expect(client).toContain('const scopeSlot = headerExtras.scopeSlot')
    expect(client).toContain('{scopeSlot !== null ? createPortal(filterMenu, scopeSlot) : (')
    // The phone header keeps nothing but the optional preset chips; empty, it takes no room.
    expect(client).toContain("'dshx:px-3 dshx:pb-1.5 dshx:empty:hidden'")
    // The project moves into the scope menu as its first section.
    expect(client).toContain('data-thread-scope-project=""')
    expect(client).toContain('<DropdownMenuRadioGroup value={projectFilterValue} onValueChange={selectProject}>')
    // The scope button names the scope in words, with one ink dot when it is narrowed.
    expect(client).toContain('ThreadListScope.label(scopeInput)')
    expect(client).toContain('data-testid="thread-scope-dot"')
  })
})
