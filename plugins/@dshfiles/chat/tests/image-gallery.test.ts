import { describe, expect, it } from 'vitest'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { ChatSettingsSchema } from '../src/chat-settings.ts'
import type { ChatGalleryImage, ImageGalleryNode } from '../src/native/chat/image-gallery.ts'
import { collectChatGalleryImages, selectChatImageGallery } from '../src/native/chat/image-gallery.ts'

const image = (turn: number, path: string, src: string, seq: number): ChatGalleryImage => ({
  turn,
  path,
  time: seq,
  image: { src, alt: path },
})

const resolvePath = (path: string): string => path.replace('/workspace/', '').replace(/^\.\//u, '')

const images = [
  image(4, '/workspace/first.png', 'image:first', 1),
  image(4, '/workspace/second.png', 'image:second', 2),
  image(5, '/workspace/third.png', 'image:third', 3),
]

const readImageCall = (path: string, turn: number, time: number): ImageGalleryNode => ({
  kind: 'tool-call',
  turn,
  data: {
    root: {
      phase: 'start',
      callId: `read-${path}`,
      name: 'read_image',
      argsRaw: JSON.stringify({ file_path: path }),
      args: PartialArguments.fromText(JSON.stringify({ file_path: path })),
      turn,
      step: 1,
      time,
      subCalls: [],
    },
  },
})

describe('Chat image gallery scope', () => {
  it('defaults to the current turn and accepts thread scope in saved Chat settings', () => {
    const settings = { performanceUsage: 'detailed', linkOpening: 'sidebar' } as const
    expect(ChatSettingsSchema(settings).imageGalleryScope).toBe('turn')
    expect(ChatSettingsSchema({ ...settings, imageGalleryScope: 'thread' }).imageGalleryScope).toBe('thread')
  })

  it('collects read_image paths in turn and chronological order', () => {
    const gallery = collectChatGalleryImages({
      nodes: [readImageCall('blue.png', 2, 20), readImageCall('red.png', 1, 10)],
      loadImage: async () => '',
      resolveImage: path => `file:${path}`,
    })

    expect(gallery.map(item => [item.turn, item.path, item.image.src])).toEqual([
      [1, 'red.png', 'file:red.png'],
      [2, 'blue.png', 'file:blue.png'],
    ])
  })

  it('starts on the clicked image and limits the default gallery to its turn', () => {
    const gallery = selectChatImageGallery({
      images,
      scope: 'turn',
      selectedPath: './second.png',
      resolvePath,
      fallbackImage: { src: 'image:second', alt: 'second.png' },
    })

    expect(gallery.images.map(item => item.src)).toEqual(['image:first', 'image:second'])
    expect(gallery.initialIndex).toBe(1)
  })

  it('includes other loaded turns when thread scope is selected', () => {
    const gallery = selectChatImageGallery({
      images,
      scope: 'thread',
      selectedPath: '/workspace/second.png',
      resolvePath,
      fallbackImage: { src: 'image:second', alt: 'second.png' },
    })

    expect(gallery.images.map(item => item.src)).toEqual(['image:first', 'image:second', 'image:third'])
    expect(gallery.initialIndex).toBe(1)
  })

  it('keeps an unindexed opened image in the thread gallery', () => {
    const gallery = selectChatImageGallery({
      images,
      scope: 'thread',
      resolvePath,
      fallbackImage: { src: 'image:external', alt: 'external.png' },
    })

    expect(gallery.images.map(item => item.src)).toEqual([
      'image:first', 'image:second', 'image:third', 'image:external',
    ])
    expect(gallery.initialIndex).toBe(3)
  })
})
