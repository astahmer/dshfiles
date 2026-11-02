import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness, type WireInput, type WireOutcome } from './host-test-harness.js'

/**
 * Characterization for the Effect-native rewrite (plans/effect-native/reviews/vcs-multihost.md §4 step 0, jj-int g):
 * the exact wire `code` (and message) every jj-integration API failure path answers today, through the real
 * Connection route a browser posts to and through the agent tools. The rewrite must keep this table unchanged.
 */

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const toolOutputSchema = Schema.Struct({
  summary: Schema.optional(Schema.String),
  result: Schema.optional(Schema.NullOr(Schema.Struct({ status: Schema.String }))),
})

const withoutRoot = (outcome: WireOutcome, root: string): WireOutcome =>
  outcome === 'ok' ? outcome : { code: outcome.code, message: outcome.message.replaceAll(root, '<root>') }

describe.skipIf(!jjAvailable)('jj-integration wire error codes', () => {
  let root: string
  let repo: string
  let plain: string
  let harness: JjIntegrationTestHarness
  let busyThread: string
  let unregisteredThread: string
  let unknownThread: string
  let idleThread: string

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-wire-codes-')))
    repo = join(root, 'repo')
    plain = join(root, 'plain')
    mkdirSync(plain)
    JjIntegrationTestHost.initRepository(repo)
    harness = await JjIntegrationTestHost.start()
    harness.setSession('session-busy', { running: true, questions: 0, title: 'Busy thread' })
    harness.setSession('session-question', { running: false, questions: 1, title: 'Asking thread' })
    harness.setSession('session-unreadable', { running: false, questions: 0, unreadable: true })
    busyThread = await harness.provisionThread(repo, { sessionIds: ['session-busy', 'session-question'] })
    unregisteredThread = await harness.provisionThread(repo)
    harness.unregister(unregisteredThread)
    unknownThread = await harness.provisionThread(repo, { sessionIds: ['session-unreadable'] })
    harness.setSession('session-idle', { running: false, questions: 0 })
    idleThread = await harness.provisionThread(repo, { sessionIds: ['session-idle'] })
  })

  afterAll(async () => {
    await harness?.dispose()
    rmSync(`${repo}-threads`, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('answers every API failure path with a stable code', async () => {
    const table: Record<string, WireOutcome | string | boolean> = {}
    const record = async (name: string, method: Parameters<JjIntegrationTestHarness['wire']>[0], input: WireInput) => {
      table[name] = withoutRoot(await harness.wire(method, input), root)
    }

    await record('destination: unknown workspace', 'destination', { workspaceId: 'missing' })
    await record('land: folder outside jj', 'land', { path: plain })
    await record('land: repository root', 'land', { path: repo })
    await record('land: busy sessions', 'land', { path: busyThread })
    await record('land: unregistered thread', 'land', { path: unregisteredThread })
    await record('land: unknown session with bookmark', 'land', { path: unknownThread, bookmark: 'main' })
    await record('land: unknown session queues', 'land', { path: unknownThread })
    const refusedProgress = (await harness.api.integrationProgress({ path: unknownThread })).progress
    table['integrationProgress: after the queued refusal'] = refusedProgress !== null && ['queued', 'validating'].includes(refusedProgress.phase)
    table['cancelQueuedLand: the entry the refusal queued'] = (await harness.api.cancelQueuedLand({ path: unknownThread })).status
    table['cancelQueuedLand: nothing queued'] = (await harness.api.cancelQueuedLand({ path: unknownThread })).status
    await record('queueLand: unknown session', 'queueLand', { path: unknownThread })
    table['cancelQueuedLand: an explicitly queued entry'] = (await harness.api.cancelQueuedLand({ path: unknownThread })).status
    table['integrationProgress: never integrated'] = (await harness.api.integrationProgress({ path: idleThread })).progress === null
    await record('queueLand: repository root', 'queueLand', { path: repo })
    await record('queueLand: folder outside jj', 'queueLand', { path: plain })
    await record('reviewHistory: relative path', 'reviewHistory', { path: 'thread-abc' })
    await record('reviewHistory: unregistered owner', 'reviewHistory', { path: join(root, 'elsewhere-threads', 'thread-abc') })
    await record('threadStatus: browser without path', 'threadStatus', {})
    await record('threadStatus: folder outside jj', 'threadStatus', { path: plain })
    await record('landThread: browser without path', 'landThread', {})
    await record('isolate: browser caller', 'isolate', {})
    await record('revisionGraph: repository root', 'revisionGraph', { path: repo })
    await record('revisionGraph: folder outside jj', 'revisionGraph', { path: plain })
    await record('discard: repository root', 'discard', { path: repo, force: false })
    await record('discardMany: mixed', 'discardMany', { paths: [repo, plain], force: false, confirm: true })
    await record('land: missing bookmark', 'land', { path: idleThread, bookmark: 'no-such-bookmark' })
    await record('land: invalid input', 'land', { path: 42 })
    await record('cleanupWorkspaces: folder outside jj', 'cleanupWorkspaces', { path: plain, olderThanHours: 1, kinds: ['empty'], apply: false })

    expect(table).toMatchInlineSnapshot(`
      {
        "cancelQueuedLand: an explicitly queued entry": "cancelled",
        "cancelQueuedLand: nothing queued": "not-queued",
        "cancelQueuedLand: the entry the refusal queued": "cancelled",
        "cleanupWorkspaces: folder outside jj": {
          "code": "not-a-repository",
          "message": "<root>/plain is not inside a jj repository.",
        },
        "destination: unknown workspace": {
          "code": "workspace-not-found",
          "message": "The workspace destination is unknown. Refresh and retry.",
        },
        "discard: repository root": {
          "code": "not-a-thread",
          "message": "<root>/repo is not a thread workspace.",
        },
        "discardMany: mixed": "ok",
        "integrationProgress: after the queued refusal": true,
        "integrationProgress: never integrated": true,
        "isolate: browser caller": {
          "code": "agent-only",
          "message": "Only an agent Session can isolate its working directory.",
        },
        "land: busy sessions": {
          "code": "thread-active",
          "message": "This workspace is still in use: “Busy thread” is still working; “Asking thread” is waiting for an answer. Integrate once every thread in it is idle.",
        },
        "land: folder outside jj": {
          "code": "not-a-repository",
          "message": "<root>/plain is not inside a jj repository.",
        },
        "land: invalid input": {
          "code": "contract",
          "message": "API schema validation failed: path: Expected string.",
        },
        "land: missing bookmark": {
          "code": "jj-failed",
          "message": "jj rebase -b @ -d no-such-bookmark --skip-emptied: Error: Revision \`no-such-bookmark\` doesn't exist",
        },
        "land: repository root": {
          "code": "not-a-thread",
          "message": "This workspace is not a thread.",
        },
        "land: unknown session queues": {
          "code": "integration-queued",
          "message": "This workspace is not verifiably idle yet; the integration is queued.",
        },
        "land: unknown session with bookmark": {
          "code": "thread-activity-unknown",
          "message": "Could not verify whether this workspace is idle. The selected bookmark was not queued; refresh and retry.",
        },
        "land: unregistered thread": {
          "code": "thread-activity-unknown",
          "message": "Could not verify thread activity before rebasing.",
        },
        "landThread: browser without path": {
          "code": "no-path",
          "message": "Pass the thread workspace path; this caller has no working directory.",
        },
        "queueLand: folder outside jj": {
          "code": "not-a-thread",
          "message": "This workspace is not a thread.",
        },
        "queueLand: repository root": {
          "code": "not-a-thread",
          "message": "This workspace is not a thread.",
        },
        "queueLand: unknown session": "ok",
        "reviewHistory: relative path": {
          "code": "not-a-thread",
          "message": "The removed thread workspace path must be absolute.",
        },
        "reviewHistory: unregistered owner": {
          "code": "not-a-thread",
          "message": "The owning project for this removed thread workspace is not registered.",
        },
        "revisionGraph: folder outside jj": {
          "code": "not-a-repository",
          "message": "<root>/plain is not inside a jj repository.",
        },
        "revisionGraph: repository root": {
          "code": "not-a-thread",
          "message": "<root>/repo is not a managed thread workspace.",
        },
        "threadStatus: browser without path": {
          "code": "no-path",
          "message": "Pass the thread workspace path; this caller has no working directory.",
        },
        "threadStatus: folder outside jj": {
          "code": "not-a-repository",
          "message": "<root>/plain is not inside a jj repository.",
        },
      }
    `)
  })

  it('answers agent tools with the message of the same failure, the code staying on the wire only', async () => {
    const table: Record<string, { readonly status: string | null; readonly summary: string | undefined } | { readonly error: string }> = {}
    const record = async (name: string, tool: string, args: WireInput, agent: { readonly sessionId: string; readonly cwd: string }) => {
      try {
        const output = Schema.decodeUnknownSync(toolOutputSchema)(JSON.parse(await harness.runTool(tool, args, agent)))
        table[name] = {
          status: output.result === undefined ? 'n/a' : (output.result?.status ?? null),
          summary: output.summary?.startsWith('{') === true ? '<json result>' : output.summary,
        }
      } catch (error) {
        table[name] = { error: (error instanceof Error ? error.message : String(error)).replaceAll(root, '<root>') }
      }
    }
    await record('jj_thread_isolate: outside jj', 'jj_thread_isolate', {}, { sessionId: 'agent-plain', cwd: plain })
    await record('jj_thread_isolate: no working directory', 'jj_thread_isolate', {}, { sessionId: 'agent-nocwd', cwd: '' })
    await record('jj_thread_rebase: shared checkout', 'jj_thread_rebase', {}, { sessionId: 'agent-root', cwd: repo })
    await record('jj_thread_rebase: busy sibling session', 'jj_thread_rebase', {}, { sessionId: 'session-busy', cwd: busyThread })
    await record('jj_thread_rebase: unverifiable sibling session', 'jj_thread_rebase', {}, { sessionId: 'agent-unknown', cwd: unknownThread })
    await record('jj_thread_rebase: owner session exempt from its own guard', 'jj_thread_rebase', {}, { sessionId: 'session-unreadable', cwd: unknownThread })
    await record('jj_thread_status: no working directory', 'jj_thread_status', {}, { sessionId: 'agent-nocwd', cwd: '' })
    await record('jj_thread_discard: shared checkout', 'jj_thread_discard', { path: repo, force: false }, { sessionId: 'agent-root', cwd: repo })

    expect(table).toMatchInlineSnapshot(`
      {
        "jj_thread_discard: shared checkout": {
          "error": "<root>/repo is not a thread workspace.",
        },
        "jj_thread_isolate: no working directory": {
          "error": "This agent Session has no working directory to isolate.",
        },
        "jj_thread_isolate: outside jj": {
          "error": "Workspace isolation requires a Session inside a local jj repository.",
        },
        "jj_thread_rebase: busy sibling session": {
          "error": "This workspace is still in use: “Busy thread” is still working; “Asking thread” is waiting for an answer. Integrate once every thread in it is idle.",
        },
        "jj_thread_rebase: owner session exempt from its own guard": {
          "status": "landed",
          "summary": "<json result>",
        },
        "jj_thread_rebase: shared checkout": {
          "status": null,
          "summary": "This Session does not run in a thread workspace; nothing to rebase.",
        },
        "jj_thread_rebase: unverifiable sibling session": {
          "error": "Could not verify whether this workspace is idle. Refresh and retry integration.",
        },
        "jj_thread_status: no working directory": {
          "error": "Pass the thread workspace path; this caller has no working directory.",
        },
      }
    `)
  })
})
