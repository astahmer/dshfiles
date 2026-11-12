#!/usr/bin/env node
// Turns one recorded DSH Session log into a shape-only replay workload for tests/compaction-replay.spec.ts.
// Keeps sizes, tool names, skill names, image counts and the turn/step order; drops every text, argument and output,
// so the fixture holds nothing private. Usage:
//   zstd -dcq ~/.dsh/sessions/<slug>/<id>/session.v4.jsonl.zstd | node scripts/replay-workload.mjs --name tool-heavy --max-calls 1500 > tests/fixtures/replay/tool-heavy.json
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    kind: { type: 'string', default: '' },
    'max-calls': { type: 'string', default: '1000000' },
  },
})
const maxCalls = Number(values['max-calls'])

const SKILL_RESULT = /^<skill_content name="([^"]+)">/
const textChars = content => (Array.isArray(content) ? content.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0) : 0)
const imageCount = content => (Array.isArray(content) ? content.filter(block => block.type === 'image').length : 0)

const workload = { name: values.name, kind: values.kind, source: '', route: null, systemChars: 0, tools: [], events: [] }
const toolChars = new Map()
const pending = new Map()
let calls = 0
let stopped = false

for await (const line of createInterface({ input: process.stdin })) {
  if (stopped) break
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  const data = event.data
  switch (event.type) {
    case 'session':
      workload.source = event.id
      break
    case 'request/context':
      workload.route ??= { provider: data.provider, model: data.model, contextWindow: data.contextWindow }
      break
    case 'system/message':
      workload.systemChars = Math.max(workload.systemChars, textChars(data.message.content))
      break
    case 'request/header':
      for (const tool of data.header.tools ?? []) toolChars.set(tool.name, Math.max(toolChars.get(tool.name) ?? 0, JSON.stringify(tool).length))
      break
    case 'user/message': {
      if (event.surfaceOp !== 'append' || data.source?.kind === 'compact-checkpoint') break
      workload.events.push(['u', textChars(data.content), imageCount(data.content), data.source?.kind ?? 'user'])
      break
    }
    case 'assistant/message': {
      if (event.surfaceOp !== undefined && event.surfaceOp !== 'append') break
      const content = data.message.content
      const toolCalls = content.filter(block => block.type === 'tool-call')
      const step = [
        'a',
        content.reduce((sum, block) => sum + (block.type === 'text' ? block.text.length : 0), 0),
        content.reduce((sum, block) => sum + (block.type === 'reasoning' ? block.text.length : 0), 0),
        toolCalls.map(block => {
          const call = [block.name, block.arguments.length, 0, 0, 0, null]
          pending.set(block.id, call)
          toolChars.set(block.name, toolChars.get(block.name) ?? 200)
          return call
        }),
      ]
      workload.events.push(step)
      calls += toolCalls.length
      if (calls >= maxCalls) stopped = true
      break
    }
    case 'tool/result': {
      if (event.surfaceOp !== 'append') break
      const call = pending.get(data.message.toolCallId)
      if (call === undefined) break
      pending.delete(data.message.toolCallId)
      const content = data.message.content
      call[2] = textChars(content)
      call[3] = imageCount(content)
      call[4] = data.message.isError === true ? 1 : 0
      const first = content.find(block => block.type === 'text')
      call[5] = first === undefined ? null : (SKILL_RESULT.exec(first.text)?.[1] ?? null)
      break
    }
  }
}
// Calls whose result never arrived (an interrupted step) replay with an empty result.
workload.tools = [...toolChars.entries()].sort((left, right) => left[0].localeCompare(right[0]))
process.stdout.write(`${JSON.stringify(workload)}\n`)
