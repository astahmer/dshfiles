import type { Context } from '@deepseek-ai/cordis'
import * as upstream from '@deepseek-ai/dsh-tool-ask-user'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_GUIDANCE, OPTION_DESCRIPTION, QUESTION_DESCRIPTION } from './markdown-guidance.ts'
import { registerTimedAskUser } from './native/timed.ts'

interface RegisteredTool {
  readonly name: string
  readonly description: string
  readonly parameters: object
}

type Register = (ctx: Context) => void

/** Run one registration against a context that only records the tool it registers. */
const registered = (register: Register): RegisteredTool => {
  const tools: RegisteredTool[] = []
  const ctx = { tools: { register: (definition: RegisteredTool) => (tools.push(definition), () => undefined) }, userQuestions: {} }
  // SAFETY: registration only reads ctx.tools.register and ctx.userQuestions; it never touches the rest of Context.
  register(ctx as unknown as Context)
  const [tool] = tools
  if (tool === undefined) throw new Error('no tool registered')
  return tool
}

const DESCRIPTION_TEXT = /"description":"(?:[^"\\]|\\.)*",?/g

/** The schema with every description text removed: what the model may send, not how it is told. */
const withoutDescriptions = (tool: RegisteredTool): string => JSON.stringify(tool.parameters).replace(DESCRIPTION_TEXT, '')

/** The `question` property's description, wherever defineTool placed the questions schema. */
const questionField = (tool: RegisteredTool): string => {
  const pending: unknown[] = [tool.parameters]
  while (pending.length > 0) {
    const node = pending.pop()
    if (!(node instanceof Object)) continue
    const entries: readonly (readonly [string, unknown])[] = Object.entries(node)
    for (const [key, child] of entries) if (key === 'question' && child instanceof Object && 'description' in child) return String(child.description)
    pending.push(...entries.map(([, child]) => child).reverse())
  }
  throw new Error('no question property in the schema')
}

// The web profile runs the timed mode (`tool-ask-user` config `mode: timed`), so that is the schema compared here.
const ours = (): RegisteredTool => registered(ctx => registerTimedAskUser(ctx, 300))
const theirs = (): RegisteredTool => registered(ctx => upstream.apply(ctx, { mode: 'timed', timeout: 300 }))

describe('ask_user_question in timed mode', () => {
  it('keeps the upstream schema exactly, descriptions aside', () => {
    expect(ours().name).toBe(theirs().name)
    expect(withoutDescriptions(ours())).toBe(withoutDescriptions(theirs()))
  })

  it('tells the model that questions are markdown with sandboxed html previews', () => {
    const tool = ours()
    expect(tool.description.endsWith(MARKDOWN_GUIDANCE)).toBe(true)
    expect(questionField(tool)).toBe(QUESTION_DESCRIPTION)
    expect(questionField(tool)).toMatch(/```html preview/)
    expect(questionField(tool)).toMatch(/no network and no same-origin access/)
    expect(JSON.stringify(tool.parameters)).toContain(JSON.stringify(OPTION_DESCRIPTION))
  })
})
