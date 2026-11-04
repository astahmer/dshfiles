import assert from 'node:assert/strict'
import test from 'node:test'
import { AdeMigrationMapModel, renderMigrationMap, renderMovedTo } from './ade-migration-map.mjs'

const feature = (plugin, id, surface, destination, currentSurface) => ({ plugin, id, title: `${id} title`, surface, destination, currentSurface })

test('groups features by destination and maps each left-nav entry to where its features go', () => {
  const map = renderMigrationMap([
    feature('usage', 'usage-charts', 'destinationSection', 'observe', 'left-nav: Usage: Analytics › Charts'),
    feature('ai-accounts', 'model-routing', 'settingsSection', 'settings', 'left-nav: AI Accounts: Accounts › Models'),
    feature('ai-accounts', 'quota-forecast', 'destinationSection', 'observe', 'left-nav: AI Accounts: Quota forecast'),
    feature('apply-patch', 'apply-patch-tool', 'agentToolOnly', 'none', 'agent tool: apply_patch'),
  ])
  assert.match(map, /\| AI Accounts: Accounts \| Settings \| ai-accounts\/model-routing → Settings \(settingsSection\) \|/)
  assert.match(map, /\| Usage: Analytics \| Observe \| usage\/usage-charts → Observe \(destinationSection\) \|/)
  assert.match(map, /### Observe\n\nrail destination; 2 features\./)
  assert.match(map, /\| agent tool \| 1 \| No place of its own 1 \|/)
  assert.doesNotMatch(map, /### Inbox/)
})

test('escapes table pipes and is deterministic regardless of input order', () => {
  const rows = [feature('b', 'two', 'command', 'none', 'palette: a | b'), feature('a', 'one', 'threadFacet', 'thread-panel', 'right-pane: btw tab')]
  const forward = renderMigrationMap(rows)
  assert.equal(renderMigrationMap([...rows].reverse()), forward)
  assert.match(forward, /palette: a \\\| b/)
})

test('refuses a destination the shell does not have', () => {
  assert.throws(() => renderMigrationMap([feature('x', 'y', 'detail', 'home', 'left-nav: X')]), /unknown destination: x\/y=home/)
})

test('lists every former left-nav entry once with its destinations, natives last', () => {
  const rows = [
    feature('usage', 'usage-charts', 'destinationSection', 'observe', 'left-nav: Usage: Analytics › Charts'),
    feature('usage', 'usage-log', 'destinationSection', 'observe', 'left-nav: Usage: Analytics'),
    feature('traces', 'alert-rules', 'attentionProvider', 'inbox', 'left-nav: Traces: Explorer › Alerts'),
    feature('traces', 'trace-explorer', 'destinationSection', 'observe', 'left-nav: Traces: Explorer'),
  ]
  const moves = AdeMigrationMapModel.leftNavMoves(rows)
  assert.deepEqual(moves.slice(0, 2), [
    { entry: 'Traces: Explorer', destinations: ['inbox', 'observe'] },
    { entry: 'Usage: Analytics', destinations: ['observe'] },
  ])
  assert.deepEqual(
    moves.slice(2).map(move => move.entry),
    ['Plugins', 'Schedules'],
  )
  assert.match(renderMovedTo(rows), /\{ entry: 'Usage: Analytics', destinations: \['observe'\] \},/)
})
