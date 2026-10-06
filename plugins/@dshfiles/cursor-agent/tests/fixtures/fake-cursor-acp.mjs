import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream } from '@agentclientprotocol/sdk'

const configDirectory = process.env.CURSOR_CONFIG_DIR
if (configDirectory !== undefined) {
  mkdirSync(configDirectory, { recursive: true })
  appendFileSync(join(configDirectory, 'fixture-events.jsonl'), `${JSON.stringify({ type: 'process-start' })}\n`)
}

if (configDirectory === undefined || process.env.CURSOR_API_KEY !== 'scratch-only-cursor-fixture') {
  throw new Error('Scratch Cursor fixture requires its isolated config directory and synthetic credential.')
}

if (process.argv[2] !== 'acp') throw new Error('Scratch Cursor fixture only supports ACP mode.')

mkdirSync(configDirectory, { recursive: true })

const statePath = join(configDirectory, 'fixture-session.json')
const eventsPath = join(configDirectory, 'fixture-events.jsonl')
const responseGatePath = join(configDirectory, 'hold-prompt-response')
const recordEvent = type => appendFileSync(eventsPath, `${JSON.stringify({ type })}\n`)
const existingEvents = () => {
  try {
    return readFileSync(eventsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
  } catch {
    return []
  }
}

const application = agent({ name: 'dsh-cursor-acp-fixture' })
  .onRequest(methods.agent.initialize, ({ params }) => {
    recordEvent('initialize')
    return {
      protocolVersion: params.protocolVersion,
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }
  })
  .onRequest(methods.agent.session.new, () => {
    const sessionId = 'scratch-cursor-session'
    writeFileSync(statePath, JSON.stringify({ sessionId }))
    recordEvent('new')
    return { sessionId }
  })
  .onRequest(methods.agent.session.load, ({ params }) => {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    if (typeof state !== 'object' || state === null || state.sessionId !== params.sessionId) {
      throw new Error('Scratch Cursor fixture received an unknown persisted session.')
    }
    recordEvent('load')
    return {}
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const promptIndex = existingEvents().filter(event => event.type === 'prompt').length + 1
    recordEvent('prompt')
    if (existsSync(responseGatePath)) recordEvent('response-gated')
    while (existsSync(responseGatePath)) await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
    recordEvent('response-ready')
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `cursor-fixture-response-${promptIndex}` },
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      const failure = message.includes('closed')
        ? 'closed'
        : message.includes('write') ? 'write-failed' : 'unknown'
      recordEvent(`response-notification-failed:${failure}`)
      throw new Error('Scratch Cursor fixture could not notify its client.')
    })
    recordEvent('response-notified')
    recordEvent('response')
    return { stopReason: 'end_turn' }
  })
  .onNotification(methods.agent.session.cancel, () => {
    recordEvent('cancel')
  })

const connection = application.connect(
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
)

await connection.closed
