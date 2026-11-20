import { describe, expect, it } from 'vitest'
import { SubagentRouteLabelModel } from './subagent-provenance/route-label.js'
import { ToolSteps } from './tool-steps.js'

describe('tool steps', () => {
  it('names a tool call in words, never by its identifier', () => {
    expect(ToolSteps.ofName('mcp__dsh__bash')).toEqual({ words: 'Running a command', waitsForAnswer: false })
    expect(ToolSteps.ofName('apply_patch').words).toBe('Editing a file')
    expect(ToolSteps.ofName('read').words).toBe('Reading a file')
    expect(ToolSteps.ofName('grep').words).toBe('Searching')
    expect(ToolSteps.ofName('jj_details').words).toBe('Using jj details')
  })

  it('says a call that holds the caller until someone answers is waiting, not working', () => {
    for (const tool of ['ask_parent_question', 'ask_user_question', 'mcp__dsh__ask_user_question']) {
      expect(ToolSteps.ofName(tool)).toEqual({ words: 'Waiting for an answer', waitsForAnswer: true })
    }
  })

  it("shows a route by its model's name, and nothing for a route that names no model", () => {
    expect(SubagentRouteLabelModel.modelName('dshx_fake_commandcode/gpt-6-luna')).toBe('gpt-6-luna')
    expect(SubagentRouteLabelModel.modelName('openai')).toBeUndefined()
    expect(SubagentRouteLabelModel.modelName(undefined)).toBeUndefined()
  })
})
