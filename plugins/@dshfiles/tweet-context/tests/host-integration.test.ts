import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { LlmRuntime, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { defineApi, dshxRegistryApi, method } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import hostDefinition from '../src/host.js'

const listingSchema = z.object({
  result: z.object({
    ok: z.literal(true),
    value: z.object({ output: z.object({ tools: z.array(z.object({ name: z.string(), source: z.string(), owner: z.string().optional() })) }) }),
  }),
})

describe('tweet context Host integration', () => {
  it('executes for a scoped Agent, saves photo and video frames, and retains plugin ownership', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'tweet-context-integration-'))
    const host = await createTestHost()
    let disposeAgent: (() => Promise<void>) | undefined
    try {
      const videoPath = join(temp, 'video.mp4')
      const photoPath = join(temp, 'photo.jpg')
      execFileSync('ffmpeg', [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=320x240:d=2',
        '-c:v',
        'mpeg4',
        '-pix_fmt',
        'yuv420p',
        '-y',
        videoPath,
      ])
      execFileSync('ffmpeg', [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=320x240',
        '-frames:v',
        '1',
        '-y',
        photoPath,
      ])
      const video = await readFile(videoPath)
      const photo = await readFile(photoPath)
      const fetcher: typeof fetch = async input => {
        const url = new URL(input instanceof Request ? input.url : String(input))
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
      }
      vi.stubGlobal('fetch', fetcher)
      await host.ctx.plugin(SessionProjectionRegistry)
      await host.ctx.plugin(SessionStore)
      await host.ctx.plugin(LlmRuntime)
      await host.ctx.plugin(AgentRegistry)
      await host.ctx.plugin(TokenMeter)
      await host.ctx.plugin(AgentLoop)
      await host.ctx.plugin(LocalAttachmentStore, { dshHome: temp })
      const mounted = await host.mount(hostDefinition, { packageId: '@dshfiles/tweet-context' })
      const handle = await host.ctx.agents.create({
        sessionId: SessionId('tweet-context-integration'),
        agentOptions: { provider: 'fixture', model: 'fixture' },
      })
      disposeAgent = () => handle.dispose()
      expect(() => handle.agent.ctx.attachments).toThrow('cannot get property "attachments" without inject')
      const result = await host.tools.execute({
        callId: ToolCallId('tweet-context-call'),
        name: 'tweet_context',
        arguments: { url: 'https://x.com/fixture/status/123' },
        agent: handle.agent,
        signal: AbortSignal.timeout(30000),
      })
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
        const stored = await host.ctx.attachments.readImage(image.attachment)
        expect(stored.data.byteLength).toBeGreaterThan(0)
      }
      const fixtureApi = defineApi({ id: 'fixture', version: 1, owner: '@test/fixture', methods: { ping: method<void, string>() } })
      await host.mount(defineHost({ apis: [fixtureApi.host({ ping: () => 'ok' })] }), { packageId: '@test/fixture' })
      const response = await host.connection.requestApi({ packageId: dshxRegistryApi.owner!, apiId: dshxRegistryApi.id, method: 'list', version: 1, input: {} })
      const listing = listingSchema.parse(await response.json()).result.value.output
      expect(listing.tools.find(tool => tool.name === 'tweet_context')).toMatchObject({ source: 'plugin', owner: '@dshfiles/tweet-context' })
      await mounted.dispose()
      expect(host.tools.schemas().some(tool => tool.name === 'tweet_context')).toBe(false)
    } finally {
      await disposeAgent?.()
      await host.dispose()
      vi.unstubAllGlobals()
      await rm(temp, { recursive: true, force: true })
    }
  }, 60000)

  it.skipIf(process.env.TWEET_CONTEXT_LIVE !== '1')(
    'retrieves the reported public post and its quoted video through a real scoped Agent',
    async () => {
      const temp = await mkdtemp(join(tmpdir(), 'tweet-context-live-'))
      const host = await createTestHost()
      let disposeAgent: (() => Promise<void>) | undefined
      try {
        await host.ctx.plugin(SessionProjectionRegistry)
        await host.ctx.plugin(SessionStore)
        await host.ctx.plugin(LlmRuntime)
        await host.ctx.plugin(AgentRegistry)
        await host.ctx.plugin(TokenMeter)
        await host.ctx.plugin(AgentLoop)
        await host.ctx.plugin(LocalAttachmentStore, { dshHome: temp })
        await host.mount(hostDefinition, { packageId: '@dshfiles/tweet-context' })
        const handle = await host.ctx.agents.create({ sessionId: SessionId('tweet-context-live'), agentOptions: { provider: 'fixture', model: 'fixture' } })
        disposeAgent = () => handle.dispose()
        const result = await host.tools.execute({
          callId: ToolCallId('tweet-context-live-call'),
          name: 'tweet_context',
          arguments: { url: 'https://x.com/pitus_/status/2115019751646974021' },
          agent: handle.agent,
          signal: AbortSignal.timeout(115_000),
        })
        expect(result.isError, JSON.stringify(result.content)).toBe(false)
        const text = result.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n')
        expect(text).toContain('Now in dark mode')
        expect(text).toContain('Generative UI #2')
        expect(text).not.toContain('Media warning:')
        expect(result.content.filter(block => block.type === 'image').length).toBeGreaterThan(6)
      } finally {
        await disposeAgent?.()
        await host.dispose()
        await rm(temp, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
