import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistryPlugin from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { decodeBundle, encodeBundle } from './bundle-codec.js'
import { BundleTransfer } from './transfer-client.js'
import { threadStoreLayer } from './host-edge-promise.js'
import { PACKAGE_ID, ThreadTransfer } from './transfer-service.js'

/** An imported message's content parts; the test reads attachment references off them as the store returned them. */
const decodeContent = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.Array(Schema.Any) }))

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

/** Fixture events are plain JSON; the persistence backend validates each one as it would a live log's. */
const isSessionEvent = (value: unknown): value is SessionEvent => typeof value === 'object' && value !== null && 'seq' in value && 'type' in value

/** A 1×1 PNG: the attachment store decodes every image it saves. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/**
 * One "machine": its own DSH home, Session storage, attachment store and workspace registry, with one project folder.
 * Two of them share nothing, which is what the coworker's machine is.
 */
const machine = (name: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), `thread-transfer-${name}-`)))
      const project = join(root, 'projects', `${name}-app`)
      await mkdir(project, { recursive: true })
      const host = await createTestHost()
      await host.ctx.plugin(Storage)
      await host.ctx.plugin(StorageJson, { root: join(root, 'storage') })
      await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
      await host.ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
      await host.ctx.plugin(LocalAttachmentStore, { dshHome: root })
      await host.ctx.plugin(WorkspaceRegistryPlugin)
      const workspace = await host.ctx.workspaceRegistry.create(project, `${name} app`)
      const layer = ThreadTransfer.layer.pipe(
        Layer.provide(Layer.mergeAll(threadStoreLayer, nodeFileSystemLayer, nodePathLayer)),
        Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: PACKAGE_ID })),
      )
      return { root, project, host, workspace, layer }
    }),
    created =>
      Effect.promise(async () => {
        await created.host.dispose()
        await rm(created.root, { recursive: true, force: true })
      }),
  )

type Machine = Effect.Success<ReturnType<typeof machine>>

const transfer = (on: Machine) => Effect.provide(Effect.service(ThreadTransfer), on.layer)

/** A finished thread on `on`: a prompt with a screenshot and a file, a tool call and its result, a title and a model. */
const seedThread = (on: Machine) =>
  Effect.promise(async () => {
    const image = await on.host.ctx.attachments.saveImage({ data: PNG, mediaType: 'image/png', name: 'screenshot.png' })
    const file = await on.host.ctx.attachments.saveFile({ data: new TextEncoder().encode('stack trace\n'), name: 'trace.log' })
    const id = SessionId('session-source-thread')
    const handle = await on.host.ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 1_700_000_000_000,
      cwd: on.project,
      isSeeded: false,
    })
    const route = { provider: 'deepseek', model: 'deepseek-chat' }
    // The tool call names a path on this machine: the bundle carries it verbatim, but nothing needs it to replay.
    const readArguments = JSON.stringify({ file_path: `${on.project}/src/login.ts` })
    const events = [
      { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
      { seq: 1, type: 'step/start', time: 2, data: { turn: 1, step: 1 } },
      {
        seq: 2,
        type: 'user/message',
        time: 3,
        surfaceOp: 'append',
        data: {
          id: 'message-1',
          role: 'user',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'Why does login fail? See the screenshot and trace.' },
            { type: 'image', attachment: image },
            { type: 'file', attachment: file },
          ],
        },
      },
      { seq: 3, type: 'session/title', time: 4, data: { title: 'Login fails after refresh', messageSeqs: [2], source: { kind: 'fallback' } } },
      {
        seq: 4,
        type: 'assistant/message',
        time: 5,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 1,
          message: {
            id: 'message-2',
            role: 'assistant',
            content: [{ type: 'tool-call', id: 'call-1', name: 'read', arguments: readArguments }],
            source: { kind: 'model', ...route },
          },
        },
      },
      { seq: 5, type: 'tool/call', time: 6, data: { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: readArguments } },
      {
        seq: 6,
        type: 'tool/result',
        time: 7,
        surfaceOp: 'append',
        sourceEventSeqs: [5],
        data: {
          turn: 1,
          step: 1,
          message: {
            id: 'message-3',
            role: 'tool',
            source: { kind: 'tool', callId: 'call-1' },
            toolCallId: 'call-1',
            content: [{ type: 'text', text: 'export const login = () => {}' }],
            isError: false,
          },
        },
      },
      { seq: 7, type: 'step/end', time: 8, data: { turn: 1, step: 1 } },
      { seq: 8, type: 'step/start', time: 9, data: { turn: 1, step: 2 } },
      {
        seq: 9,
        type: 'assistant/message',
        time: 10,
        surfaceOp: 'append',
        data: {
          turn: 1,
          step: 2,
          message: {
            id: 'message-4',
            role: 'assistant',
            content: [{ type: 'text', text: 'The token is never refreshed.' }],
            source: { kind: 'model', ...route },
          },
        },
      },
      { seq: 10, type: 'step/end', time: 11, data: { turn: 1, step: 2 } },
      { seq: 11, type: 'turn/end', time: 12, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    // oxlint-disable-next-line antislop/no-passthrough-variable -- widening to unknown lets the type guard narrow each fixture record
    const records: readonly unknown[] = events
    await handle.append(records.filter(isSessionEvent))
    await handle.flush()
    await handle.close()
    return { sessionId: String(id), image, file, events }
  })

const readThread = (on: Machine, sessionId: string) =>
  Effect.promise(async () => {
    const handle = await on.host.ctx.sessionPersistence.open(SessionId(sessionId), 'read')
    const read = await handle.read()
    await handle.close()
    const header = await on.host.ctx.sessionPersistence.stat(SessionId(sessionId))
    return { events: read.events, header: header?.header }
  })

/** Two real Hosts with storage, persistence and an attachment store boot per test; slow CI machines need the room. */
describe('ThreadTransfer', () => {
  it.live(
    'exports a thread on one machine and imports it on another as a new thread in a chosen project',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* machine('alice')
          const target = yield* machine('bob')
          const seeded = yield* seedThread(source)

          // Browser path on the source: stage, then read every chunk.
          const exporter = yield* transfer(source)
          const exported = yield* exporter.exportStaged(seeded.sessionId)
          expect(exported.summary).toMatchObject({
            title: 'Login fails after refresh',
            messageCount: 2,
            model: { provider: 'deepseek', model: 'deepseek-chat' },
            eventCount: 12,
            attachmentCount: 2,
            missingAttachments: 0,
          })
          expect(exported.fileName).toBe('login-fails-after-refresh.dshthread')
          const chunks: Uint8Array[] = []
          let offset = 0
          for (;;) {
            const chunk = yield* exporter.readChunk({ transferId: exported.transferId, offset })
            chunks.push(BundleTransfer.fromBase64(chunk.data))
            offset = chunk.nextOffset
            if (chunk.done) break
          }
          const file = Buffer.concat(chunks)
          expect(file.byteLength).toBe(exported.bytes)

          // Browser path on the target: upload, preview, import into Bob's project.
          const service = yield* transfer(target)
          const { transferId } = yield* service.beginImport(file.byteLength)
          yield* service.writeChunk({ transferId, offset: 0, data: BundleTransfer.toBase64(file) })
          const preview = yield* service.inspect({ transferId })
          expect(preview.problem).toBeNull()
          expect(preview.summary.folderName).toBe('alice-app')
          const imported = yield* service.importThread({ source: { transferId }, workspaceId: String(target.workspace.id), cwd: undefined })

          expect(imported.sessionId).not.toBe(seeded.sessionId)
          expect(imported).toMatchObject({
            title: 'Login fails after refresh',
            cwd: target.project,
            workspaceId: String(target.workspace.id),
            events: 12,
            attachments: 2,
          })
          expect(target.host.ctx.workspaceRegistry.get(target.workspace.id)?.sessionIds.map(String)).toContain(imported.sessionId)

          const stored = yield* readThread(target, imported.sessionId)
          expect(stored.header).toMatchObject({ cwd: target.project, isSeeded: false })
          expect(stored.events.map(event => event.type)).toEqual(seeded.events.map(event => event.type))
          // Every non-attachment byte of the conversation came across unchanged, tool calls and results included.
          expect(stored.events.filter(event => event.seq !== 2).map(event => event.data)).toEqual(
            seeded.events.filter(event => event.seq !== 2).map(event => event.data),
          )

          // The attachments now live in Bob's store, readable through the references the imported log carries.
          const content = decodeContent(stored.events[2]?.data).content
          const image = yield* Effect.promise(() => target.host.ctx.attachments.readImage(content[1].attachment))
          expect(image.ref.mediaType).toBe('image/png')
          const chunksRead: Uint8Array[] = []
          for (const chunk of [content[2].attachment].map(ref => target.host.ctx.attachments.readFileStream(ref)))
            for (const part of yield* Effect.promise(async () => {
              const parts: Uint8Array[] = []
              for await (const piece of chunk) parts.push(piece)
              return parts
            }))
              chunksRead.push(part)
          expect(Buffer.concat(chunksRead).toString('utf8')).toBe('stack trace\n')

          // The source is untouched, and the upload is released once imported.
          expect((yield* readThread(source, seeded.sessionId)).events).toHaveLength(12)
          const reused = yield* Effect.flip(service.inspect({ transferId }))
          expect(reused._tag).toBe('TransferExpired')
        }),
      ),
    30_000,
  )

  it.live(
    'writes and reads bundle files on the Host for the agent tools, into the home folder by default',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const source = yield* machine('carol')
          const target = yield* machine('dave')
          const seeded = yield* seedThread(source)
          const path = join(source.root, 'out', 'login.dshthread')
          yield* Effect.promise(() => mkdir(join(source.root, 'out')))

          const written = yield* Effect.flatMap(transfer(source), service => service.exportFile({ sessionId: seeded.sessionId, path }))
          expect(written.path).toBe(path)
          expect((yield* Effect.promise(() => stat(path))).size).toBe(written.bytes)
          const again = yield* Effect.flip(Effect.flatMap(transfer(source), service => service.exportFile({ sessionId: seeded.sessionId, path })))
          expect(again.message).toMatch(/A file already exists at this path/u)

          const copy = join(target.root, 'from-carol.dshthread')
          yield* Effect.promise(async () => (await import('node:fs/promises')).writeFile(copy, await readFile(path)))
          const service = yield* transfer(target)
          const imported = yield* service.importThread({ source: { path: copy }, workspaceId: undefined, cwd: target.project })
          // An existing project folder joins its project even when named by path.
          expect(imported.workspaceId).toBe(String(target.workspace.id))
          const home = yield* service.importThread({ source: { path: copy }, workspaceId: undefined, cwd: target.root })
          expect(home).toMatchObject({ cwd: target.root, workspaceId: null })
          expect(home.sessionId).not.toBe(imported.sessionId)
        }),
      ),
    30_000,
  )

  it.live(
    'refuses an unknown thread, a missing folder and an expired transfer with a recovery hint',
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const on = yield* machine('erin')
          const service = yield* transfer(on)
          const missing = yield* Effect.flip(service.exportStaged('session-nope'))
          expect(missing.message).toMatch(/is not stored on this machine/u)
          const seeded = yield* seedThread(on)
          const path = join(on.root, 'x.dshthread')
          yield* service.exportFile({ sessionId: seeded.sessionId, path })
          const folder = yield* Effect.flip(service.importThread({ source: { path }, workspaceId: undefined, cwd: join(on.root, 'nowhere') }))
          expect(folder.message).toMatch(/does not exist\. Pick a registered project or an existing folder/u)
          const project = yield* Effect.flip(service.importThread({ source: { path }, workspaceId: 'workspace-unknown', cwd: undefined }))
          expect(project._tag).toBe('DestinationInvalid')
          const expired = yield* Effect.flip(service.readChunk({ transferId: 'transfer-gone', offset: 0 }))
          expect(expired.message).toMatch(/Start the export or import again/u)

          // A log this DSH cannot replay (here a title citing no message) is archived, not left as a broken thread.
          const bundle = yield* decodeBundle(new Uint8Array(yield* Effect.promise(() => readFile(path))))
          const broken = {
            ...bundle,
            events: bundle.events.map(event =>
              JSON.stringify(event).includes('session/title') ? decodeJson(JSON.stringify(event).replace('"messageSeqs":[2]', '"messageSeqs":[]')) : event,
            ),
          }
          const brokenPath = join(on.root, 'broken.dshthread')
          yield* Effect.promise(async () => (await import('node:fs/promises')).writeFile(brokenPath, Effect.runSync(encodeBundle(broken))))
          const refused = yield* Effect.flip(service.importThread({ source: { path: brokenPath }, workspaceId: undefined, cwd: on.project }))
          expect(refused.message).toMatch(/could not replay the imported log here, so it was archived/u)
          const archived = on.host.ctx.workspaceRegistry.archivedSessionIds.map(String)
          expect(archived).toHaveLength(1)
          expect(archived[0]).not.toBe(seeded.sessionId)
        }),
      ),
    30_000,
  )
})
