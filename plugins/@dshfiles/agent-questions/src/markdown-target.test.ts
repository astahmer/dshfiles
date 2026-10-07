import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureMarkdownAnchor, currentMarkdownRevision } from './markdown-target.js'

const roots: string[] = []

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-markdown-feedback-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Markdown feedback anchors', () => {
  it('captures exact workspace lines against the whole-file revision', async () => {
    const workspacePath = await createRoot()
    await mkdir(join(workspacePath, 'docs'))
    await writeFile(join(workspacePath, 'docs/guide.md'), '# Guide\n\nKeep this section.\n')

    const anchor = await captureMarkdownAnchor({
      workspacePath,
      path: 'docs/guide.md',
      startLine: 3,
      endLine: 3,
      selectedText: 'Keep this section.',
    })

    expect(anchor).toMatchObject({
      kind: 'markdown',
      path: 'docs/guide.md',
      startLine: 3,
      endLine: 3,
      excerpt: 'Keep this section.',
    })
    expect(anchor.revision).toMatch(/^[a-f0-9]{64}$/)
    expect(await currentMarkdownRevision({ workspacePath, path: anchor.path })).toBe(anchor.revision)
  })

  it('rejects traversal, symlinks, and a quote that does not match the source lines', async () => {
    const workspacePath = await createRoot()
    const outsidePath = join(workspacePath, 'outside.md')
    await writeFile(outsidePath, 'private')
    await symlink(outsidePath, join(workspacePath, 'linked.md'))
    await writeFile(join(workspacePath, 'guide.md'), '# Guide\n')

    await expect(
      captureMarkdownAnchor({
        workspacePath,
        path: '../outside.md',
        startLine: 1,
        endLine: 1,
        selectedText: 'private',
      }),
    ).rejects.toThrow()
    await expect(
      captureMarkdownAnchor({
        workspacePath,
        path: 'linked.md',
        startLine: 1,
        endLine: 1,
        selectedText: 'private',
      }),
    ).rejects.toThrow(/symlinks/)
    await expect(
      captureMarkdownAnchor({
        workspacePath,
        path: 'guide.md',
        startLine: 1,
        endLine: 1,
        selectedText: 'changed text',
      }),
    ).rejects.toThrow(/does not match/)
  })

  it('returns no revision after the document is removed or becomes unsafe', async () => {
    const workspacePath = await createRoot()
    await writeFile(join(workspacePath, 'guide.md'), '# Guide\n')
    expect(await currentMarkdownRevision({ workspacePath, path: 'guide.md' })).not.toBeNull()
    await rm(join(workspacePath, 'guide.md'))
    expect(await currentMarkdownRevision({ workspacePath, path: 'guide.md' })).toBeNull()
  })
})
