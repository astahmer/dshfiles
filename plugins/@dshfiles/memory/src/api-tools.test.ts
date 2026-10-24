import { describe, expect, test } from 'vitest'
import { memoryApi } from './api.js'

describe('memory tool exposure', () => {
  test('the memory panel actions an Agent may take are named tools', () => {
    const tools = Object.values(memoryApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'find_threads',
      'memory_archive_note',
      'memory_citations',
      'memory_edit_note',
      'memory_forget_note',
      'memory_note',
      'memory_note_counts',
      'memory_note_history',
      'memory_notes',
      'memory_projects',
      'memory_read',
      'memory_restore_note',
      'memory_review_notes',
      'memory_search',
      'memory_start_block',
      'memory_thread_detail',
      'memory_threads',
      'memory_usage',
      'related_threads',
    ])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual([
      'find_threads',
      'memory_citations',
      'memory_note_counts',
      'memory_note_history',
      'memory_notes',
      'memory_projects',
      'memory_read',
      'memory_review_notes',
      'memory_search',
      'memory_start_block',
      'memory_thread_detail',
      'memory_threads',
      'memory_usage',
      'related_threads',
    ])
  })

  test('the note-correction writes ask for the user request and the rest stay untooled on purpose', () => {
    expect(memoryApi.methods.editNote.description).toMatch(/Call only when the user asked/u)
    expect(memoryApi.methods.forgetNote.description).toMatch(/Call only when the user asked/u)
    expect(memoryApi.methods.archiveNote.description).toMatch(/Call only when the user asked/u)
    expect(memoryApi.methods.restoreNote.description).toMatch(/Call only when the user asked/u)
    expect(memoryApi.methods.reviewNotes.description).toMatch(/suggestions only/u)
    // usage needs the full MemoryUsage schema, so the Agent gets the bounded usageSummary instead;
    // preview duplicates memory_read and would count as an agent memory-tool call; rateCitation would let
    // an Agent rate its own citations; createNote and redigest are the panel's own verbs.
    for (const name of ['usage', 'preview', 'rateCitation', 'createNote', 'redigest'] as const) {
      expect(memoryApi.methods[name].tool).toBeUndefined()
    }
  })
})
