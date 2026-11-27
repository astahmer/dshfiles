import assert from 'node:assert/strict'
import { test } from 'vitest'

import type { AgentTools } from './agent.js'
import type { ToolCatalogView } from './api.js'
import { groupRowId, MAX_TOOL_EDITS_PER_CALL, toolRowId, ToolTrees } from './tool-tree.js'

const catalog: ToolCatalogView = {
  groups: [
    {
      key: 'mcp:github',
      kind: 'mcp',
      label: 'github',
      tools: [
        { name: 'mcp__github__list_issues', summary: 'List issues.' },
        { name: 'mcp__github__create_pr', summary: 'Open a pull request.' },
      ],
    },
    {
      key: 'native',
      kind: 'native',
      label: 'DSH',
      tools: [
        { name: 'read', summary: 'Read a file.' },
        { name: 'tool_search', summary: 'Find tools.' },
      ],
    },
  ],
}
const NONE: AgentTools = { tools: {}, groups: {} }
const github = catalog.groups[0]!
const native = catalog.groups[1]!
const groupOf = (tree: ReturnType<typeof ToolTrees.build>, key: string) => tree.groups.find(group => group.key === key)!

test('a group checkbox is checked, cleared or mixed by its children', () => {
  assert.equal(groupOf(ToolTrees.build(catalog, NONE, NONE), 'mcp:github').enabled, true)
  const one = ToolTrees.setTool(NONE, { name: 'mcp__github__create_pr', group: 'mcp:github' }, 'enabled', false)
  const tree = ToolTrees.build(catalog, one, NONE)
  assert.equal(groupOf(tree, 'mcp:github').enabled, 'indeterminate')
  assert.equal(groupOf(tree, 'mcp:github').enabledCount, 1)
  assert.equal(tree.enabled, 3)
  assert.equal(tree.total, 4)
  const off = ToolTrees.setGroup(NONE, github, 'enabled', false)
  assert.equal(groupOf(ToolTrees.build(catalog, off, NONE), 'mcp:github').enabled, false)
  // Pins are mixed among enabled children only, and a click on a partial state checks every child.
  const pinned = ToolTrees.setTool(NONE, { name: 'read', group: 'native' }, 'pinned', true)
  assert.equal(groupOf(ToolTrees.build(catalog, pinned, NONE), 'native').pinned, 'indeterminate')
  assert.equal(ToolTrees.nextCheck('indeterminate'), true)
  assert.equal(ToolTrees.nextCheck(true), false)
})

test('a tool shows whether its state is set on it or inherited from its group', () => {
  const off = ToolTrees.setGroup(NONE, github, 'enabled', false)
  const inherited = groupOf(ToolTrees.build(catalog, off, NONE), 'mcp:github').tools[0]!
  assert.equal(inherited.decision.by, 'group')
  assert.equal(inherited.entry, undefined)
  const explicit = ToolTrees.setTool(off, { name: 'mcp__github__list_issues', group: 'mcp:github' }, 'enabled', true)
  assert.deepEqual(explicit.tools, { mcp__github__list_issues: { enabled: true } })
  const row = groupOf(ToolTrees.build(catalog, explicit, NONE), 'mcp:github').tools[0]!
  assert.equal(row.decision.by, 'tool')
  assert.equal(row.decision.enabled, true)
  assert.equal(row.changed, false, 'enabled before and after, so not a visible change')
})

test('toggling back to the inherited value leaves no entry, and reset drops an entry', () => {
  const tool = { name: 'read', group: 'native' }
  const off = ToolTrees.setTool(NONE, tool, 'enabled', false)
  assert.deepEqual(off.tools, { read: { enabled: false } })
  assert.deepEqual(ToolTrees.setTool(off, tool, 'enabled', true), NONE)
  const pinnedOff = ToolTrees.setTool(off, tool, 'pinned', true)
  assert.deepEqual(pinnedOff.tools, { read: { enabled: false, pinned: true } })
  assert.deepEqual(ToolTrees.reset(pinnedOff, { kind: 'tool', key: 'read' }), NONE)
  const group = ToolTrees.setGroup(NONE, github, 'pinned', true)
  assert.deepEqual(ToolTrees.reset(group, { kind: 'group', key: 'mcp:github' }), NONE)
})

test('a group change makes every child follow it, keeping their other field', () => {
  let access = ToolTrees.setTool(NONE, { name: 'mcp__github__create_pr', group: 'mcp:github' }, 'enabled', false)
  access = ToolTrees.setTool(access, { name: 'mcp__github__create_pr', group: 'mcp:github' }, 'pinned', true)
  const all = ToolTrees.setGroup(access, github, 'enabled', true)
  assert.deepEqual(all, { tools: { mcp__github__create_pr: { pinned: true } }, groups: {} })
  const none = ToolTrees.setGroup(all, github, 'enabled', false)
  assert.deepEqual(none.groups, { 'mcp:github': { enabled: false } })
  assert.equal(groupOf(ToolTrees.build(catalog, none, NONE), 'mcp:github').enabledCount, 0)
})

test('reserved tools stay enabled whatever the group says', () => {
  const off = ToolTrees.setGroup(NONE, native, 'enabled', false)
  assert.equal(ToolTrees.setTool(off, { name: 'tool_search', group: 'native' }, 'enabled', false), off)
  const row = groupOf(ToolTrees.build(catalog, off, NONE), 'native').tools.find(tool => tool.name === 'tool_search')!
  assert.equal(row.reserved, true)
  assert.equal(row.decision.enabled, true)
})

test('the save batch holds one edit per changed entry, null for a removed one', () => {
  const saved: AgentTools = { tools: { read: { enabled: false } }, groups: { 'mcp:github': { pinned: true } } }
  let draft = ToolTrees.reset(saved, { kind: 'tool', key: 'read' })
  draft = ToolTrees.setGroup(draft, github, 'enabled', false)
  draft = ToolTrees.setTool(draft, { name: 'mcp__github__list_issues', group: 'mcp:github' }, 'enabled', true)
  assert.deepEqual(ToolTrees.edits(saved, draft), [
    { target: { kind: 'group', key: 'mcp:github' }, entry: { enabled: false, pinned: true } },
    { target: { kind: 'tool', key: 'mcp__github__list_issues' }, entry: { enabled: true } },
    { target: { kind: 'tool', key: 'read' }, entry: null },
  ])
  // Undoing every change leaves nothing to send, whatever the key order.
  assert.deepEqual(ToolTrees.edits(saved, { groups: { 'mcp:github': { pinned: true } }, tools: { read: { enabled: false } } }), [])
  const many = Array.from({ length: MAX_TOOL_EDITS_PER_CALL + 1 }, (_, index) => ({ target: { kind: 'tool' as const, key: `t${String(index)}` }, entry: null }))
  assert.deepEqual(
    ToolTrees.batches(many).map(batch => batch.length),
    [MAX_TOOL_EDITS_PER_CALL, 1],
  )
  assert.deepEqual(ToolTrees.batches([]), [])
})

test('changed tools are counted against the saved access', () => {
  const draft = ToolTrees.setGroup(NONE, github, 'enabled', false)
  const tree = ToolTrees.build(catalog, draft, NONE)
  assert.equal(tree.changed, 2)
  assert.equal(groupOf(tree, 'mcp:github').changed, true)
  assert.equal(groupOf(tree, 'native').changed, false)
})

test('the filter matches tool names, descriptions and group labels', () => {
  assert.deepEqual(
    ToolTrees.build(catalog, NONE, NONE, 'pull').groups.map(group => [group.key, group.matches.map(tool => tool.name)]),
    [['mcp:github', ['mcp__github__create_pr']]],
  )
  assert.equal(ToolTrees.build(catalog, NONE, NONE, 'dsh').groups[0]?.matches.length, 2)
  assert.deepEqual(ToolTrees.build(catalog, NONE, NONE, 'nothing-like-this').groups, [])
  // Counts stay over every tool, so the filter never changes "N tools selected".
  assert.equal(ToolTrees.build(catalog, NONE, NONE, 'pull').total, 4)
})

test('collapsed groups render one row each; an expanded one renders a page then a more row', () => {
  const tree = ToolTrees.build(catalog, NONE, NONE)
  assert.deepEqual(
    ToolTrees.rows(tree, { isExpanded: () => false, limitOf: () => 50 }).map(row => row.kind),
    ['group', 'group'],
  )
  const rows = ToolTrees.rows(tree, { isExpanded: key => key === 'mcp:github', limitOf: () => 1 })
  assert.deepEqual(
    rows.map(row => row.kind),
    ['group', 'tool', 'more', 'group'],
  )
  assert.equal(rows[2]?.kind === 'more' ? rows[2].hidden : 0, 1)
})

test('tree keys move through rows and open or close groups', () => {
  const tree = ToolTrees.build(catalog, NONE, NONE)
  const collapsed = ToolTrees.rows(tree, { isExpanded: () => false, limitOf: () => 50 })
  const first = groupRowId('mcp:github')
  assert.deepEqual(ToolTrees.move(collapsed, first, 'ArrowDown'), { kind: 'focus', id: groupRowId('native') })
  assert.deepEqual(ToolTrees.move(collapsed, first, 'ArrowRight'), { kind: 'expand', key: 'mcp:github' })
  assert.equal(ToolTrees.move(collapsed, first, 'ArrowLeft'), null)
  assert.equal(ToolTrees.move(collapsed, first, 'ArrowUp'), null)
  const open = ToolTrees.rows(tree, { isExpanded: key => key === 'mcp:github', limitOf: () => 50 })
  const child = toolRowId('mcp:github', 'mcp__github__list_issues')
  assert.deepEqual(ToolTrees.move(open, first, 'ArrowRight'), { kind: 'focus', id: child })
  assert.deepEqual(ToolTrees.move(open, first, 'ArrowLeft'), { kind: 'collapse', key: 'mcp:github' })
  assert.deepEqual(ToolTrees.move(open, child, 'ArrowLeft'), { kind: 'focus', id: first })
  assert.deepEqual(ToolTrees.move(open, child, 'End'), { kind: 'focus', id: groupRowId('native') })
  assert.deepEqual(ToolTrees.move(open, 'gone', 'ArrowDown'), { kind: 'focus', id: first })
})
