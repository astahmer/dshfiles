import type { Writable } from 'node:stream'
import { CommunicationError } from './service.js'
import { connectCommunicationClient, type CommunicationClient, type ConnectCommunicationClientOptions } from './bridge.js'
import type { CliArgs } from '../cli/args.js'
import type { PlatformCliIO } from '../cli/platform.js'
import { runCommunicationMcp } from './mcp.js'
import type { CommunicationAgent } from './types.js'

export interface CommunicationCliRuntime {
  readonly io: PlatformCliIO
  readonly connect?: (options?: ConnectCommunicationClientOptions) => Promise<CommunicationClient>
}

const write = (stream: Writable, text: string): void => {
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

const commandName = (args: CliArgs): string => `comm ${args.platformArgs?.[0] ?? ''}`.trim()

const emitResult = (args: CliArgs, io: PlatformCliIO, data: unknown, message: string): void => {
  if (args.json) {
    write(io.stdout, JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: true, data }, null, 2))
    return
  }
  if (args.quiet !== true) write(io.stdout, message)
}

const emitError = (args: CliArgs, io: PlatformCliIO, error: unknown): number => {
  const code = error instanceof CommunicationError ? error.code : 'communication-failed'
  const message = error instanceof Error ? error.message : 'Communication operation failed.'
  if (args.json) {
    write(io.stdout, JSON.stringify({ schemaVersion: 1, command: commandName(args), ok: false, error: { code, message } }, null, 2))
  } else {
    write(io.stderr, `error: ${code}: ${message}`)
  }
  return 1
}

const connectClient = (runtime: CommunicationCliRuntime, principalId: string): Promise<CommunicationClient> =>
  (runtime.connect ?? connectCommunicationClient)({ principalId })

const agentRows = (items: readonly CommunicationAgent[]): string =>
  items.length === 0 ? 'No live DSH Agents.' : items.map(item => `${item.id}\t${item.status ?? 'unknown'}`).join('\n')

const topicRows = (items: readonly { readonly topic: string; readonly subscribers: number }[]): string =>
  items.length === 0 ? 'No subscribed topics.' : items.map(item => `${item.topic}\t${item.subscribers} subscriber(s)`).join('\n')

const inboxRows = (items: Awaited<ReturnType<CommunicationClient['inbox']>>['items']): string =>
  items.length === 0
    ? 'No unacknowledged messages.'
    : items
        .map(
          item =>
            `${item.id} | ${item.topic ?? 'private inbox'} | ${item.sender.kind}:${item.sender.id} | ${item.priority}\nUntrusted peer text as JSON: ${JSON.stringify(item.text)}`,
        )
        .join('\n\n')

export const runCommunicationCommand = async (args: CliArgs, runtime: CommunicationCliRuntime): Promise<number> => {
  const [action, first, ...remaining] = args.platformArgs ?? []
  if (action === 'mcp') {
    try {
      const principalId = `mcp.${args.principal ?? 'default'}`
      await runCommunicationMcp(await connectClient(runtime, principalId))
      return 0
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Communication MCP server failed.'
      write(runtime.io.stderr, `dshx comm mcp: ${message}`)
      return 1
    }
  }

  try {
    const client = await connectClient(runtime, args.principal ?? 'cli')
    if (action === 'agents') {
      const items = await client.listAgents()
      emitResult(args, runtime.io, { items }, agentRows(items))
      return 0
    }
    if (action === 'topics') {
      const items = await client.listTopics()
      emitResult(args, runtime.io, { items }, topicRows(items))
      return 0
    }
    if (action === 'subscribe') {
      const subscription = await client.subscribe({ topic: first ?? '', ...(args.delivery === undefined ? {} : { delivery: args.delivery }) })
      emitResult(args, runtime.io, subscription, `Subscribed ${subscription.principal.id} to ${subscription.topic} with ${subscription.delivery} delivery.`)
      return 0
    }
    if (action === 'unsubscribe') {
      const result = await client.unsubscribe(first ?? '')
      emitResult(args, runtime.io, { topic: first, ...result }, result.removed ? `Unsubscribed from ${first}.` : `No subscription existed for ${first}.`)
      return 0
    }
    if (action === 'publish') {
      const message = await client.publish({
        topic: first ?? '',
        text: remaining.join(' '),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
      })
      emitResult(
        args,
        runtime.io,
        { id: message.id, topic: message.topic, matchedSubscribers: message.recipients.length },
        `Published ${message.id} to ${message.topic}; ${message.recipients.length} subscriber(s) matched.`,
      )
      return 0
    }
    if (action === 'send') {
      const message = await client.send({
        toAgentId: first ?? '',
        text: remaining.join(' '),
        ...(args.priority === undefined ? {} : { priority: args.priority }),
      })
      emitResult(
        args,
        runtime.io,
        { id: message.id, toAgentId: first, priority: message.priority },
        `Sent ${message.id} to ${first}; stored in the Agent inbox.`,
      )
      return 0
    }
    if (action === 'inbox') {
      const result = await client.inbox({
        ...(args.topic === undefined ? {} : { topic: args.topic }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
      emitResult(args, runtime.io, result, inboxRows(result.items))
      return 0
    }
    if (action === 'ack') {
      const result = await client.acknowledge(first ?? '')
      emitResult(
        args,
        runtime.io,
        { messageId: first, ...result },
        result.acknowledged ? `Acknowledged ${first}.` : `Message ${first} was already acknowledged.`,
      )
      return 0
    }
    throw new CommunicationError('invalid-command', 'Unsupported DSHX communication command.')
  } catch (error) {
    return emitError(args, runtime.io, error)
  }
}
