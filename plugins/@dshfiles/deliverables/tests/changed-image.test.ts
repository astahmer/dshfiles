import { mkdtemp, mkdir, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceChangesSummary } from '@deepseek-ai/dsh-workspace-changes/types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_CHANGED_IMAGE_BYTES, changesImageUrl, imageTypeOf } from '../src/changed-image.ts'
import { serveChangedImage } from '../src/changed-image-route.ts'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

describe('imageTypeOf', () => {
  it('names the media type of each previewable image extension, in any case', () => {
    expect(imageTypeOf('docs/screenshots/getting-started-390.png')).toBe('image/png')
    expect(imageTypeOf('a/b.JPG')).toBe('image/jpeg')
    expect(imageTypeOf('b.jpeg')).toBe('image/jpeg')
    expect(imageTypeOf('c.gif')).toBe('image/gif')
    expect(imageTypeOf('d.webp')).toBe('image/webp')
    expect(imageTypeOf('e.svg')).toBe('image/svg+xml')
    expect(imageTypeOf('C:\\shots\\f.avif')).toBe('image/avif')
  })

  it('refuses other files, dotfiles and extension-like directory names', () => {
    expect(imageTypeOf('dist/client.js')).toBeUndefined()
    expect(imageTypeOf('.png')).toBeUndefined()
    expect(imageTypeOf('shots.png/readme')).toBeUndefined()
    expect(imageTypeOf('archive.constructor')).toBeUndefined()
  })
})

describe('serveChangedImage', () => {
  let root: string
  let outside: string
  const ctx = new Context()

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'deliverables-image-'))
    outside = await mkdtemp(join(tmpdir(), 'deliverables-outside-'))
    await mkdir(join(root, 'shots'))
    await writeFile(join(root, 'shots/new.png'), PNG)
    await writeFile(join(root, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await writeFile(join(root, 'notes.bin'), PNG)
    await writeFile(join(outside, 'secret.png'), PNG)
    await symlink(join(outside, 'secret.png'), join(root, 'linked.png'))
    await writeFile(join(root, 'huge.png'), '')
    await truncate(join(root, 'huge.png'), MAX_CHANGED_IMAGE_BYTES + 1)
    await ctx.plugin(LocalFileSystem, { cwd: root })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  const serve = (query: { sessionId?: string; seq?: string; index: number | string }) => {
    const listed = ['shots/new.png', 'icon.svg', 'notes.bin', 'linked.png', relative(root, join(outside, 'secret.png')), 'huge.png', 'gone.png']
    const summary: WorkspaceChangesSummary = {
      turn: 1,
      cwd: root,
      total: listed.length,
      added: 0,
      deleted: 0,
      files: [
        ...listed.map(path => ({ path, display: path, added: 0, deleted: 0, binary: true as const })),
        { path: join(outside, 'secret.png'), display: 'secret.png', added: 0, deleted: 0, binary: true },
      ],
    }
    const params = new URLSearchParams({ sessionId: query.sessionId ?? 'session-1', seq: query.seq ?? '7', index: String(query.index) })
    return serveChangedImage(
      { fs: ctx.fs, changes: { summary: (sessionId, seq) => (sessionId === 'session-1' && seq === 7 ? summary : undefined) } },
      new Request(`http://host/api/changes.image?${params}`),
    )
  }

  it('serves a listed image inside the workspace with its media type', async () => {
    const response = await serve({ index: 0 })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('serves an SVG as an image under a sandboxing policy', async () => {
    const response = await serve({ index: 1 })
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  })

  it('refuses a file that is not an image', async () => {
    expect((await serve({ index: 2 })).status).toBe(415)
  })

  it('refuses a symlink, a parent path and an absolute path leaving the workspace', async () => {
    expect((await serve({ index: 3 })).status).toBe(403)
    expect((await serve({ index: 4 })).status).toBe(403)
    expect((await serve({ index: 7 })).status).toBe(403)
  })

  it('answers 413 above the size cap instead of reading the file', async () => {
    expect((await serve({ index: 5 })).status).toBe(413)
  })

  it('answers 404 for a deleted image, an unknown summary or index, and 400 for bad coordinates', async () => {
    expect((await serve({ index: 6 })).status).toBe(404)
    expect((await serve({ index: 99 })).status).toBe(404)
    expect((await serve({ seq: '8', index: 0 })).status).toBe(404)
    expect((await serve({ index: '-1' })).status).toBe(400)
  })

  it('addresses the route from the document like the other change routes', () => {
    expect(changesImageUrl({ sessionId: SessionId('session-1'), seq: 7, index: 2 })).toBe('api/changes.image?sessionId=session-1&seq=7&index=2')
  })
})
