import type { Writable } from 'node:stream'
import { CommunicationError } from './service.js'
import { connectCommunicationClient, type CommunicationClient, type ConnectCommunicationClientOptions } from './bridge.js'
import type { CliArgs } from '../cli/args.js'
import type { PlatformCliIO } from '../cli/platform.js'
import { runCommunicationMcp } from './mcp.js'
import type { CommunicationAgent, CommunicationDiagnostics } from './types.js'

export interface CommunicationCliRuntime {
  readonly io: PlatformCliIO
  readonly connect?: (options?: ConnectCommunicationClientOptions) => Promise<CommunicationClient>
}

const write = (stream: Writable, text: string): void => {
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

const commandName = (args: CliArgs): string => `comm ${args.platformArgs?.[0] ?? ''}`.trim()

const emitResult = <Data>(args: CliArgs, io: PlatformCliIO, data: Data, message: string): void => {
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
  items.length === 0 ? 'No live DSH Agents.' : items.map(item => `${JSON.stringify(item.id)}\t${item.status ?? 'unknown'}`).join('\n')

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

const reportRows = (report: CommunicationDiagnostics): string => {
  const formatTime = (timestamp: number | null): string => (timestamp === null ? 'none' : new Date(timestamp).toISOString())
  const recentActivity =
    report.activity.events.length === 0
      ? 'No Agent tool-call activity recorded.'
      : report.activity.events
          .map(event => `${formatTime(event.occurredAt)}\t${JSON.stringify(event.principal.id)}\t${event.operation}\t${event.outcome}\t${event.durationMs}ms`)
          .join('\n')
  const agents =
    report.agents.length === 0 ? 'No live DSH Agents.' : report.agents.map(agent => `${JSON.stringify(agent.id)}\t${agent.status ?? 'unknown'}`).join('\n')
  const recentMessages =
    report.recentMessages.length === 0
      ? 'No retained messages.'
      : report.recentMessages
          .map(message => {
            return `${formatTime(message.createdAt)}\t${message.id}\t${message.topic ?? 'private inbox'}\t${message.sender.kind}:${JSON.stringify(message.sender.id)}\t${message.pendingRecipientCount}/${message.recipientCount} pending recipient(s)`
          })
          .join('\n')
  const topics =
    report.topics.length === 0 ? 'No subscribed topics.' : report.topics.map(topic => `${topic.topic}\t${topic.subscribers} subscriber(s)`).join('\n')
  const subscriptions =
    report.subscriptions.length === 0
      ? 'No subscriptions.'
      : report.subscriptions
          .map(subscription => `${subscription.topic}\t${subscription.principal.kind}:${JSON.stringify(subscription.principal.id)}\t${subscription.delivery}`)
          .join('\n')

  return [
    `Communication diagnostics generated ${formatTime(report.generatedAt)}`,
    `Live Agents: ${report.agentCount} total; showing ${report.agents.length}.`,
    agents,
    `Topics: ${report.topicCount} total; showing ${report.topics.length}.`,
    topics,
    `Subscriptions: ${report.subscriptionCount} total; showing ${report.subscriptions.length}.`,
    subscriptions,
    `Messages: ${report.messageCount} retained; ${report.pendingMessageCount} with pending recipients; ${report.pendingRecipientCount} pending recipient(s).`,
    'Recent messages (metadata only):',
    recentMessages,
    `Agent tool activity: ${report.activity.retainedCount} retained event(s); tracking started ${formatTime(report.activity.trackingStartedAt)}; oldest retained ${formatTime(report.activity.oldestRetainedAt)}.`,
    report.historyNote,
    'Recent Agent tool calls:',
    recentActivity,
  ].join('\n')
}

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
    if (action === 'report') {
      const report = await client.diagnostics({ limit: args.limit ?? 20 })
      emitResult(args, runtime.io, report, reportRows(report))
      return 0
    }
    if (action === 'subscribe') {
      if (args.delivery !== undefined)
        throw new CommunicationError('delivery-retired', 'Communication subscriptions are passive; remove the --delivery option.')
      const subscription = await client.subscribe({ topic: first ?? '' })
      emitResult(args, runtime.io, subscription, `Subscribed ${subscription.principal.id} to ${subscription.topic}; messages stay passive.`)
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
        priority: args.priority ?? 'normal',
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
        priority: args.priority ?? 'normal',
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
      const limit = args.limit ?? 20
      const inboxInput = args.topic === undefined ? { limit } : { topic: args.topic, limit }
      const result = await client.inbox(inboxInput)
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
