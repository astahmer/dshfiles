import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCliArgs } from '../src/cli/args.js'
import { connectCommunicationClient, startHostCommunicationBridge } from '../src/communication/bridge.js'
import { runCommunicationCommand } from '../src/communication/cli.js'
import { CommunicationService } from '../src/communication/service.js'
import { communicationDiagnosticsSchema, type CommunicationPrincipal } from '../src/communication/types.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('communication diagnostic CLI', () => {
  it('emits bounded metadata-only JSON without mutating durable state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshx-communication-cli-'))
    temporaryRoots.push(root)
    const service = new CommunicationService({ statePath: join(root, 'state.json') })
    const recipient: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-reader' }
    const sender: Extract<CommunicationPrincipal, { readonly kind: 'agent' }> = { kind: 'agent', id: 'agent-sender' }
    await service.subscribe(recipient, { topic: 'workspace/demo' })
    await service.publish({ sender, topic: 'workspace/demo', text: 'never-print-this-body' })
    await service.recordActivity({
      principal: recipient,
      operation: 'dshx_comm_inbox',
      outcome: 'success',
      occurredAt: Date.now(),
      durationMs: 4,
      callId: 'cli-test-call',
    })
    const beforeReport = await readFile(join(root, 'state.json'), 'utf8')
    const bridge = await startHostCommunicationBridge(service, {
      stateHome: root,
      listAgents: () => [{ id: recipient.id, status: 'idle' }],
    })
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    stdout.setEncoding('utf8')
    stderr.setEncoding('utf8')
    let output = ''
    let errorOutput = ''
    stdout.on('data', chunk => (output += chunk))
    stderr.on('data', chunk => (errorOutput += chunk))

    try {
      const exitCode = await runCommunicationCommand(parseCliArgs(['comm', 'report', '--limit', '1', '--json']), {
        io: { stdout, stderr },
        connect: options => connectCommunicationClient({ ...options, stateHome: root }),
      })

      const envelope = communicationDiagnosticsSchema.parse(JSON.parse(output).data)
      expect(exitCode).toBe(0)
      expect(errorOutput).toBe('')
      expect(envelope).toMatchObject({ agentCount: 1, topicCount: 1, messageCount: 1, activity: { retainedCount: 1 } })
      expect(output).not.toContain('never-print-this-body')
      expect(envelope.recentMessages[0]).not.toHaveProperty('text')

      const humanStdout = new PassThrough()
      const humanStderr = new PassThrough()
      humanStdout.setEncoding('utf8')
      let humanOutput = ''
      humanStdout.on('data', chunk => (humanOutput += chunk))
      await expect(
        runCommunicationCommand(parseCliArgs(['comm', 'report', '--limit', '1']), {
          io: { stdout: humanStdout, stderr: humanStderr },
          connect: options => connectCommunicationClient({ ...options, stateHome: root }),
        }),
      ).resolves.toBe(0)
      expect(humanOutput).toContain('metadata only')
      expect(humanOutput).not.toContain('never-print-this-body')
      expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(beforeReport)
    } finally {
      await bridge.close()
    }
  })
})
