import { describe, expect, test } from 'vitest'
import { graphPageOutputSchema, jujutsuApi, REVISION_PAGE_SIZE, revisionSchema } from './api.js'

describe('revision graph API payload bounds', () => {
  test('caps initial and subsequent graph page outputs to ten revisions', () => {
    const revision = revisionSchema.parse({
      commitId: 'a'.repeat(40),
      changeId: 'b'.repeat(32),
      shortestChangeId: 'b',
      description: 'x'.repeat(20_000),
      author: 'Graph Test',
      authorTime: '2026-10-26T20:00:00Z',
      parents: [],
      bookmarks: [],
      localBookmarks: [],
      tags: [],
      workspaces: [],
      workingCopy: false,
      mine: false,
      immutable: false,
      divergent: false,
      empty: false,
      conflict: false,
      evolved: false,
    })

    expect(REVISION_PAGE_SIZE).toBe(10)
    const page = { revisions: Array.from({ length: REVISION_PAGE_SIZE }, () => revision), hasMore: true }
    expect(graphPageOutputSchema.safeParse(page).success).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(1_048_576)
    const oversizedPage = { revisions: Array.from({ length: 100 }, () => revision), hasMore: true }
    expect(Buffer.byteLength(JSON.stringify(oversizedPage))).toBeGreaterThan(1_048_576)
    expect(graphPageOutputSchema.safeParse({ ...page, revisions: [...page.revisions, revision] }).success).toBe(false)
  })
})

describe('jujutsu tool exposure', () => {
  test('the graph and Source Control capabilities are named tools', () => {
    const tools = Object.values(jujutsuApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'jj_confirm_action',
      'jj_details',
      'jj_edit_times',
      'jj_graph_navigation',
      'jj_graph_page',
      'jj_graph_slice',
      'jj_load',
      'jj_prepare_action',
      'jj_reference_graph',
      'jj_register_repository',
      'jj_revision_files',
      'jj_revision_relationship',
      'jj_working_diff',
      'jj_workspaces',
    ])
  })

  test('reads are read-only and the two write steps ask for the user request', () => {
    const readOnly = Object.values(jujutsuApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
      .sort()
    expect(readOnly).toEqual([
      'jj_details',
      'jj_edit_times',
      'jj_graph_navigation',
      'jj_graph_page',
      'jj_graph_slice',
      'jj_load',
      'jj_reference_graph',
      'jj_register_repository',
      'jj_revision_files',
      'jj_revision_relationship',
      'jj_working_diff',
      'jj_workspaces',
    ])
    for (const name of ['prepare', 'confirm'] as const) {
      expect(jujutsuApi.methods[name].description ?? '').toMatch(/Call only when the user asked/u)
    }
    for (const method of Object.values(jujutsuApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
      expect(method.tool.render).toBeDefined()
    }
  })

  test('every write action stays a two-step prepare then confirm', () => {
    // The UI confirms a prepared plan; the tools keep that shape instead of applying actions directly.
    expect(jujutsuApi.methods.prepare.description ?? '').toMatch(/jj_confirm_action/u)
    expect(jujutsuApi.methods.confirm.description ?? '').toMatch(/jj_prepare_action/u)
  })
})
