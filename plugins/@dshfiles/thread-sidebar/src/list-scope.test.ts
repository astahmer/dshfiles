import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ThreadListScope } from './list-scope.js'

const scope = (filterCount: number, project: string | null) => ({ filterCount, project, filters: 'Filters' })

describe('phone thread list scope button (council round 10 B1, round 11 B2)', () => {
  it('reads "Filters" at the default scope and names the project when one is picked', () => {
    expect(ThreadListScope.label(scope(0, null))).toBe('Filters')
    expect(ThreadListScope.label(scope(2, null))).toBe('Filters')
    expect(ThreadListScope.label(scope(0, 'billing-api'))).toBe('billing-api')
    expect(ThreadListScope.label(scope(1, 'billing-api'))).toBe('billing-api')
  })

  it('counts the filters on, and shows no count at the default scope', () => {
    expect(ThreadListScope.count(scope(0, null))).toBeNull()
    expect(ThreadListScope.count(scope(0, 'billing-api'))).toBeNull()
    expect(ThreadListScope.count(scope(2, null))).toBe(2)
  })

  it('marks a narrowed scope (a view, a filter or a project) and not the default', () => {
    expect(ThreadListScope.narrowed(scope(0, null))).toBe(false)
    expect(ThreadListScope.narrowed(scope(1, null))).toBe(true)
    expect(ThreadListScope.narrowed(scope(0, 'Unassigned'))).toBe(true)
  })

  it('counts a narrowing view without status filters as one', () => {
    expect(ThreadListScope.filterCount({ filtered: false, filterLabels: 0 })).toBe(0)
    expect(ThreadListScope.filterCount({ filtered: true, filterLabels: 0 })).toBe(1)
    expect(ThreadListScope.filterCount({ filtered: true, filterLabels: 2 })).toBe(2)
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
    // The scope button reads "Filters" or the project, with a count of the filters on (council round 11 B2).
    expect(client).toContain('ThreadListScope.label(scopeInput)')
    expect(client).toContain("filters: props.tSidebar('threadSidebarFilters')")
    expect(client).toContain('data-testid="thread-scope-count"')
    expect(client).not.toContain('data-testid="thread-scope-dot"')
  })
})
