import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@dshfiles/dshx/host'

import { MemoryGuidance } from './guidance.ts'
import type { Caller, MemoryRuntime } from './runtime.ts'

const summaryOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { summary: { type: 'string', required: true } },
} satisfies ValueSchemaSpec

const summaryOutput = {
  schema: summaryOutputSchema,
  render: <Args>(_args: Args, value: InferValue<typeof summaryOutputSchema>) => [{ type: 'text' as const, text: value.summary }],
}

export const createMemoryTools = (getRuntime: () => MemoryRuntime | undefined) => {
  const run = async (agent: Caller | undefined, body: (runtime: MemoryRuntime, caller: Caller) => Promise<string>): Promise<{ readonly summary: string }> => {
    const runtime = getRuntime()
    if (!runtime) throw new Error('Memory is not active in this DSH host (setting dshfiles-memory.enabled, or the plugin failed to start).')
    if (!agent) throw new Error('Memory tools need a live DSH agent (the calling thread).')
    return { summary: await body(runtime, agent) }
  }

  const search = defineTool({
    name: 'memory_search',
    description: MemoryGuidance.searchDescription,
    parameters: {
      query: { type: 'string', required: true, description: 'A few words or an exact identifier.' },
      project: { type: 'string', description: 'Restrict to one project: "current", a project path, or "all" (default: current first, then others).' },
      limit: { type: 'integer', description: 'Hits to return, 1 to 20; default 6.' },
    },
    output: summaryOutput,
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec.agent, (runtime, caller) => runtime.search(caller, args)),
  })

  const read = defineTool({
    name: 'memory_read',
    description: MemoryGuidance.readDescription,
    parameters: {
      id: { type: 'string', required: true, description: 't:<thread id> or n:<note id>.' },
      range: { type: 'string', description: 'For a thread: "<from>-<to>" event sequence numbers (at most 60 events, 8 KB).' },
    },
    output: summaryOutput,
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec.agent, (runtime, caller) => runtime.read(caller, args)),
  })

  const note = defineTool({
    name: 'memory_note',
    description: MemoryGuidance.noteDescription,
    parameters: {
      action: { type: 'string', enum: ['add', 'update', 'forget'], description: 'Default add.' },
      text: { type: 'string', description: 'The note (add, update): one or two sentences.' },
      category: {
        type: 'string',
        enum: ['user', 'feedback', 'project', 'reference'],
        description:
          'user: who the user is, their role, expertise, preferences. feedback: a correction or a confirmed approach, with the why. project: a decision, constraint or context not derivable from code or git. reference: a pointer to an external resource. Default project.',
      },
      scope: { type: 'string', description: 'repo (default), global, or path:<subpath>. Do not widen a one-off request into a global rule.' },
      confidence: { type: 'string', enum: ['stated', 'inferred'], description: 'stated: the user said it; inferred: you concluded it. Default stated.' },
      id: { type: 'string', description: 'Note id (n:<id>) for update and forget.' },
      reason: { type: 'string', description: 'Why the note is updated or forgotten (required for both).' },
    },
    output: summaryOutput,
    execute: (args, exec) => run(exec.agent, (runtime, caller) => runtime.note(caller, args)),
  })

  return [search, read, note]
}
