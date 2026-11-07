import { describe, expect, test } from 'vitest'
import { preparationActionsFor, settleActionsFor, setupActionsFor, type SetupAction } from './workspace-setup-selection.js'

const action = (id: string, overrides: Partial<SetupAction> = {}): SetupAction => ({
  id,
  label: id,
  root: '/work',
  runOnWorkspaceCreate: true,
  awaitBeforeFirstTurn: false,
  onSettle: false,
  execution: { target: 'local' },
  ...overrides,
})

const workspace = { repoRoot: '/work/project', workspacePath: '/work/threads/thread-abc123' }

describe('workspace setup selection', () => {
  test('selects a flagged action whose trusted root spans the checkout and the thread workspace', () => {
    expect(setupActionsFor({ actions: [action('install')], workspace }).map(selected => selected.id)).toEqual(['install'])
  })

  test('refuses an action rooted at the checkout alone instead of widening its trusted root', () => {
    expect(setupActionsFor({ actions: [action('install', { root: workspace.repoRoot })], workspace })).toEqual([])
  })

  test('refuses a root outside both paths and an unrelated repository', () => {
    expect(setupActionsFor({ actions: [action('install', { root: '/elsewhere' })], workspace })).toEqual([])
    expect(setupActionsFor({ actions: [action('install', { root: '/work/other-project' })], workspace })).toEqual([])
  })

  test('ignores unflagged actions and actions that run somewhere else', () => {
    expect(setupActionsFor({ actions: [action('install', { runOnWorkspaceCreate: false })], workspace })).toEqual([])
    expect(setupActionsFor({ actions: [action('install', { execution: { target: 'remote' } })], workspace })).toEqual([])
  })

  test('settle actions are a separate trigger over the same containment rule', () => {
    const actions = [action('install'), action('snapshot', { runOnWorkspaceCreate: false, onSettle: true })]
    expect(settleActionsFor({ actions, workspace }).map(selected => selected.id)).toEqual(['snapshot'])
    expect(preparationActionsFor({ actions, workspace }).map(selected => selected.id)).toEqual(['install', 'snapshot'])
  })

  test('carries the await-before-first-turn flag to the caller', () => {
    const [selected] = preparationActionsFor({ actions: [action('install', { awaitBeforeFirstTurn: true })], workspace })
    expect(selected?.awaitBeforeFirstTurn).toBe(true)
  })
})
