import type { LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import { describe, expect, it } from 'vitest'
import type { OpenFileOptions } from '../src/native/contract/slots.ts'
import { openMarkdownExternalLink, openMarkdownFileLink } from '../src/native/chat/markdown-image-links.ts'

describe('Chat Markdown image links', () => {
  it('opens a resolvable local image link in the gallery', () => {
    const images: LightboxImage[] = []
    const imagePaths: string[] = []
    const files: { readonly path: string; readonly options: OpenFileOptions | undefined }[] = []

    openMarkdownFileLink({
      path: '/workspace/artifacts/chart.webp',
      kind: 'image',
      options: undefined,
      resolveImage: path => `file-api:${path}`,
      openImage: (image, path) => {
        images.push(image)
        imagePaths.push(path)
      },
      openFile: (path, options) => {
        files.push({ path, options })
      },
    })

    expect(images).toEqual([{ src: 'file-api:/workspace/artifacts/chart.webp', alt: 'chart.webp' }])
    expect(imagePaths).toEqual(['/workspace/artifacts/chart.webp'])
    expect(files).toEqual([])
  })

  it('keeps ordinary and unresolvable file links on the existing file opener', () => {
    const images: LightboxImage[] = []
    const files: { readonly path: string; readonly options: OpenFileOptions | undefined }[] = []
    const openFile = (path: string, options: OpenFileOptions | undefined): void => {
      files.push({ path, options })
    }
    const resolveImage = (path: string): string | undefined => (path.endsWith('.png') ? undefined : `file-api:${path}`)
    const openImage = (image: LightboxImage): void => {
      images.push(image)
    }

    openMarkdownFileLink({
      path: '/workspace/README.md',
      kind: 'document',
      options: { line: 12 },
      resolveImage,
      openImage,
      openFile,
    })
    openMarkdownFileLink({
      path: '/workspace/missing.png',
      kind: 'image',
      options: undefined,
      resolveImage,
      openImage,
      openFile,
    })

    expect(images).toEqual([])
    expect(files).toEqual([
      { path: '/workspace/README.md', options: { line: 12 } },
      { path: '/workspace/missing.png', options: undefined },
    ])
  })

  it('opens HTTP(S) image links in the gallery and keeps other URLs external', () => {
    const images: LightboxImage[] = []
    const links: string[] = []
    const openImage = (image: LightboxImage): void => {
      images.push(image)
    }
    const openExternalLink = (href: string): void => {
      links.push(href)
    }
    const imageUrl = 'https://assets.example.test/previews/result.PNG?width=1200#full'

    openMarkdownExternalLink({ href: imageUrl, kind: 'image', openImage, openExternalLink })
    openMarkdownExternalLink({ href: 'https://example.test/docs', kind: 'url', openImage, openExternalLink })

    expect(images).toEqual([{ src: imageUrl, alt: 'result.PNG' }])
    expect(links).toEqual(['https://example.test/docs'])
  })
})
