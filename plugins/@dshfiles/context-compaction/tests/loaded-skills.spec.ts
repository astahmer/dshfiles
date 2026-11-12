import { createAssistantMessage, createToolResultMessage, createUserMessage, ToolCallId, type ContentBlock, type Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { MAX_KEPT_SKILL_CHARS, withLoadedSkills } from '../src/loaded-skills.js'

const summary: ContentBlock[] = [{ type: 'text', text: '## Primary Request and Intent\n- Linearize the history.' }]

const skillBody = (name: string, instructions: string) =>
  [
    `<skill_content name="${name}">`,
    '<skill_resources>',
    `Base directory for this skill: /home/me/.agents/skills/${name}`,
    '</skill_resources>',
    '',
    '<skill_instructions>',
    instructions,
    '</skill_instructions>',
    '</skill_content>',
  ].join('\n')

const skillCall = (id: string, name: string, body: string): Message[] => {
  const callId = ToolCallId(id)
  return [
    createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'skill', arguments: JSON.stringify({ name }) }],
      source: { provider: 'scripted', model: 'small-window' },
    }),
    createToolResultMessage({ callId, content: [{ type: 'text', text: body }], isError: false }),
  ]
}

const keptText = (blocks: readonly ContentBlock[]) => {
  const last = blocks.at(-1)
  return last?.type === 'text' ? last.text : ''
}

/** The next compaction replays this checkpoint as the first message of its span. */
const checkpoint = (blocks: readonly ContentBlock[]): Message => createUserMessage({ content: [...blocks], source: { kind: 'user' } })

describe('the skills a checkpoint keeps', () => {
  it('lists each skill the replaced span loaded, once, with its directory', () => {
    const messages = [
      ...skillCall('c1', 'jj-linearize', skillBody('jj-linearize', '# Linearize\n- Rebase oldest first.')),
      ...skillCall('c2', 'traces-first', skillBody('traces-first', '# Traces first')),
      ...skillCall('c3', 'jj-linearize', skillBody('jj-linearize', '# Linearize again')),
    ]
    const blocks = withLoadedSkills({ summary, messages, mode: 'names' })
    expect(blocks.slice(0, -1)).toEqual(summary)
    const kept = keptText(blocks)
    expect(kept).toContain('- jj-linearize (/home/me/.agents/skills/jj-linearize)\n- traces-first (/home/me/.agents/skills/traces-first)')
    expect(kept).not.toContain('Rebase oldest first')
  })

  it('carries the skills an earlier checkpoint kept into the next one', () => {
    const first = withLoadedSkills({ summary, messages: skillCall('c1', 'jj-linearize', skillBody('jj-linearize', '# Linearize')), mode: 'names' })
    const second = withLoadedSkills({
      summary,
      messages: [checkpoint(first), ...skillCall('c2', 'traces-first', skillBody('traces-first', '# Traces first'))],
      mode: 'names',
    })
    expect(keptText(second)).toContain('- jj-linearize (/home/me/.agents/skills/jj-linearize)\n- traces-first (/home/me/.agents/skills/traces-first)')
  })

  it('keeps the instructions in bodies mode, and never reads a list inside them as a loaded skill', () => {
    const first = withLoadedSkills({
      summary,
      messages: skillCall('c1', 'jj-linearize', skillBody('jj-linearize', '- not-a-skill (somewhere)\n- Rebase oldest first.')),
      mode: 'bodies',
    })
    expect(keptText(first)).toContain('Rebase oldest first.')
    const second = withLoadedSkills({ summary, messages: [checkpoint(first)], mode: 'bodies' })
    expect(keptText(second)).toContain('Rebase oldest first.')
    const listed = keptText(second).split('<skill_content')[0] ?? ''
    expect(listed.match(/^- \S+/gm)).toEqual(['- jj-linearize'])
  })

  it('names a skill whose instructions exceed the budget without keeping them', () => {
    const large = skillBody('large', 'x'.repeat(MAX_KEPT_SKILL_CHARS))
    const kept = keptText(
      withLoadedSkills({ summary, messages: [...skillCall('c1', 'large', large), ...skillCall('c2', 'small', skillBody('small', 'tiny'))], mode: 'bodies' }),
    )
    expect(kept).toContain('- large (')
    expect(kept).not.toContain('x'.repeat(100))
    expect(kept).toContain('tiny')
  })

  it('ignores a skill quoted in conversation text, and changes nothing when off', () => {
    const quoted = [createUserMessage({ content: [{ type: 'text', text: skillBody('quoted', 'a pasted skill') }], source: { kind: 'user' } })]
    expect(withLoadedSkills({ summary, messages: quoted, mode: 'names' })).toEqual(summary)
    expect(withLoadedSkills({ summary, messages: skillCall('c1', 'traces-first', skillBody('traces-first', '#')), mode: 'off' })).toEqual(summary)
  })
})
