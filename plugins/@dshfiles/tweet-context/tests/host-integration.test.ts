import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { defineApi, dshxRegistryApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Schema } from 'effect'
import { tweetContextBacklogApi, tweetContextBacklogOutputSchema } from '../src/backlog-api.js'
import hostDefinition from '../src/host.js'
import { ffmpegFixture, ffmpegLayer, requestUrl, scratch, solidVideo } from './test-layers.js'

const listingSchema = Schema.Struct({
  result: Schema.Struct({
    ok: Schema.Literal(true),
    value: Schema.Struct({
      output: Schema.Struct({
        tools: Schema.Array(Schema.Struct({ name: Schema.String, source: Schema.String, owner: Schema.optional(Schema.String) })),
      }),
    }),
  }),
})
const backlogEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: tweetContextBacklogOutputSchema }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})

/**
 * FxEmbed and the X media hosts are the only fakes: the plugin's HttpClient reads the global fetch, so the test routes
 * it to `serve` for its scope and restores the real one afterwards.
 */
const fakeProviders = (serve: typeof fetch) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const real = globalThis.fetch
      globalThis.fetch = serve
      return real
    }),
    real => Effect.sync(() => (globalThis.fetch = real)),
  )

/** A real test Host with sessions, an agent loop, the local attachment store and the local subprocess runtime for ffmpeg. */
const agentHost = (dshHome: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const host = await createTestHost()
      await host.ctx.plugin(SessionProjectionRegistry)
      await host.ctx.plugin(SessionStore)
      await host.ctx.plugin(LlmRuntime)
      await host.ctx.plugin(AgentRegistry)
      await host.ctx.plugin(TokenMeter)
      await host.ctx.plugin(AgentLoop)
      await host.ctx.plugin(LocalSubprocessRuntime)
      await host.ctx.plugin(LocalAttachmentStore, { dshHome })
      return host
    }),
    host => Effect.promise(() => host.dispose()),
  )

describe('tweet context Host integration', () => {
  it.effect(
    'executes for a scoped Agent, saves photo and video frames, and retains plugin ownership',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        const fs = yield* FileSystem.FileSystem
        yield* solidVideo({ videoPath: temp.file('video.mp4') })
        yield* ffmpegFixture(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240', '-frames:v', '1', '-y', temp.file('photo.jpg')])
        const video = new Uint8Array(yield* fs.readFile(temp.file('video.mp4')))
        const photo = new Uint8Array(yield* fs.readFile(temp.file('photo.jpg')))
        yield* fakeProviders(async input => {
          const url = requestUrl(input)
          if (url.hostname === 'api.fxtwitter.com')
            return Response.json({
              code: 200,
              status: {
                text: 'Integration post',
                author: { name: 'Fixture', screen_name: 'fixture' },
                media: {
                  photos: [{ url: 'https://pbs.twimg.com/media/photo.jpg' }],
                  videos: [{ duration: 2, formats: [{ url: 'https://video.twimg.com/clip/video.mp4', container: 'mp4', bitrate: 500000 }] }],
                },
              },
            })
          if (url.hostname === 'pbs.twimg.com') return new Response(photo, { headers: { 'content-type': 'image/jpeg' } })
          if (url.hostname === 'video.twimg.com') return new Response(video, { headers: { 'content-type': 'video/mp4' } })
          throw new Error(`Unexpected fixture request: ${url.hostname}`)
        })
        const host = yield* agentHost(temp.directory)
        const mounted = yield* Effect.promise(() => host.mount(hostDefinition, { packageId: '@dshfiles/tweet-context' }))
        const handle = yield* Effect.acquireRelease(
          Effect.promise(() =>
            host.ctx.agents.create({ sessionId: SessionId('tweet-context-integration'), agentOptions: { provider: 'fixture', model: 'fixture' } }),
          ),
          created => Effect.promise(() => created.dispose()),
        )
        expect(() => handle.agent.ctx.attachments).toThrow('cannot get property "attachments" without inject')
        const result = yield* Effect.promise(() =>
          host.tools.execute({
            callId: ToolCallId('tweet-context-call'),
            name: 'tweet_context',
            arguments: { url: 'https://x.com/fixture/status/123' },
            agent: handle.agent,
            signal: AbortSignal.timeout(30000),
          }),
        )
        expect(result.isError).toBe(false)
        expect(
          result.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n'),
        ).toContain('Integration post')
        const images = result.content.filter(block => block.type === 'image')
        expect(images).toHaveLength(2)
        for (const image of images) {
          if (image.type !== 'image') throw new Error('Expected an image block')
          const stored = yield* Effect.promise(() => host.ctx.attachments.readImage(image.attachment))
          expect(stored.data.byteLength).toBeGreaterThan(0)
        }
        const response = yield* Effect.promise(async () => {
          const reply = await host.connection.requestApi({
            packageId: '@dshfiles/tweet-context',
            apiId: tweetContextBacklogApi.id,
            method: 'retrieve',
            version: tweetContextBacklogApi.version,
            input: { url: 'https://x.com/fixture/status/123' },
          })
          return reply.json()
        })
        const envelope = (yield* Schema.decodeUnknownEffect(backlogEnvelope)(response)).result
        if (!envelope.ok) throw new Error(`Tweet context API retrieval failed: ${envelope.error.code} ${envelope.error.message}`)
        const context = envelope.value.output
        expect(context.posts[0]?.text).toBe('Integration post')
        expect(context.images.length).toBeGreaterThan(0)
        for (const image of context.images) {
          const stored = yield* Effect.promise(() =>
            host.ctx.attachments.readImage({
              attachmentId: AttachmentId(image.attachmentId),
              mediaType: image.mediaType,
              bytes: image.bytes,
              width: image.width,
              height: image.height,
              name: image.name,
            }),
          )
          expect(stored.data.byteLength).toBe(image.bytes)
        }
        const refused = yield* Effect.promise(async () => {
          const reply = await host.connection.requestApi({
            packageId: '@dshfiles/tweet-context',
            apiId: tweetContextBacklogApi.id,
            method: 'retrieve',
            version: tweetContextBacklogApi.version,
            input: { url: 'https://example.com/fixture/status/123' },
          })
          return reply.json()
        })
        expect(refused).toMatchObject({ result: { ok: false, error: { code: 'invalid-tweet-url' } } })
        const fixtureApi = defineApi({ id: 'fixture', version: 1, owner: '@test/fixture', methods: { ping: method<void, string>() } })
        yield* Effect.promise(() => host.mount(defineHost({ apis: [fixtureApi.host({ ping: () => 'ok' })] }), { packageId: '@test/fixture' }))
        const listing = yield* Effect.promise(async () => {
          const reply = await host.connection.requestApi({
            packageId: dshxRegistryApi.owner!,
            apiId: dshxRegistryApi.id,
            method: 'list',
            version: 1,
            input: {},
          })
          return reply.json()
        })
        const tools = (yield* Schema.decodeUnknownEffect(listingSchema)(listing)).result.value.output.tools
        expect(tools.find(tool => tool.name === 'tweet_context')).toMatchObject({ source: 'plugin', owner: '@dshfiles/tweet-context' })
        yield* Effect.promise(() => mounted.dispose())
        expect(host.tools.schemas().some(tool => tool.name === 'tweet_context')).toBe(false)
      }).pipe(Effect.provide(ffmpegLayer)),
    60_000,
  )

  it.effect.skipIf(process.env.TWEET_CONTEXT_LIVE !== '1')(
    'retrieves the reported public post and its quoted video through a real scoped Agent',
    () =>
      Effect.gen(function* () {
        const temp = yield* scratch
        const host = yield* agentHost(temp.directory)
        yield* Effect.promise(() => host.mount(hostDefinition, { packageId: '@dshfiles/tweet-context' }))
        const handle = yield* Effect.acquireRelease(
          Effect.promise(() => host.ctx.agents.create({ sessionId: SessionId('tweet-context-live'), agentOptions: { provider: 'fixture', model: 'fixture' } })),
          created => Effect.promise(() => created.dispose()),
        )
        const result = yield* Effect.promise(() =>
          host.tools.execute({
            callId: ToolCallId('tweet-context-live-call'),
            name: 'tweet_context',
            arguments: { url: 'https://x.com/pitus_/status/2115019751646974021' },
            agent: handle.agent,
            signal: AbortSignal.timeout(115_000),
          }),
        )
        expect(result.isError, JSON.stringify(result.content)).toBe(false)
        const text = result.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n')
        expect(text).toContain('Now in dark mode')
        expect(text).toContain('Generative UI #2')
        expect(text).not.toContain('Media warning:')
        const imageCount = result.content.filter(block => block.type === 'image').length
        expect(imageCount).toBeGreaterThan(0)
        expect(imageCount).toBeLessThanOrEqual(12)
      }).pipe(Effect.provide(ffmpegLayer)),
    120_000,
  )
})
