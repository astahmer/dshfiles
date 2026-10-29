import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import type { ImageGalleryScope } from '../../chat-settings.ts'
import type { ChatNodeDataMap, ChatNodeKind } from '../contract/chat-nodes.ts'
import type { ToolCallBlock, UserMessageNode } from '../contract/snapshot.ts'

export type ImageGalleryNodeKind = Extract<ChatNodeKind,
  'assistant-step' | 'user' | 'steering' | 'context' | 'turn-trigger' | 'tool-call'>

export type ImageGalleryNode = {
  [Kind in ImageGalleryNodeKind]: {
    readonly kind: Kind
    readonly turn: number
    readonly data: ChatNodeDataMap[Kind]
  }
}[ImageGalleryNodeKind]

type ChatContentBlock = UserMessageNode['content'][number]
type ChatImageAttachment = Extract<ChatContentBlock, { type: 'image' }>['attachment']

export interface ChatGalleryImage {
  readonly turn: number
  readonly path?: string
  readonly time: number
  readonly image: LightboxImage
  readonly load?: () => Promise<string>
}

export interface ImageGallerySelection {
  readonly images: readonly LightboxImage[]
  readonly initialIndex: number
  readonly loaders: readonly ((() => Promise<string>) | undefined)[]
}

const basename = (path: string): string => path.split(/[\\/]/u).at(-1) || path

const loadedImage = (input: {
  readonly attachment: ChatImageAttachment
  readonly path?: string
  readonly loadImage: MessageImageLoader
}): Pick<ChatGalleryImage, 'image' | 'load'> => {
  const src = input.loadImage.peek?.(input.attachment)
  return {
    image: { ...(src === undefined ? {} : { src }), alt: input.path === undefined ? 'Image' : basename(input.path) },
    load: () => input.loadImage(input.attachment),
  }
}

const appendContentImages = (input: {
  readonly content: readonly ChatContentBlock[]
  readonly turn: number
  readonly time: number
  readonly path?: string
  readonly loadImage: MessageImageLoader
  readonly output: ChatGalleryImage[]
}): void => {
  for (const block of input.content) {
    if (block.type !== 'image') continue
    input.output.push({
      turn: input.turn,
      time: input.time,
      ...input.path === undefined ? {} : { path: input.path },
      ...loadedImage({ attachment: block.attachment, ...(input.path === undefined ? {} : { path: input.path }), loadImage: input.loadImage }),
    })
  }
}

const appendToolImages = (input: {
  readonly block: ToolCallBlock
  readonly turn: number
  readonly loadImage: MessageImageLoader
  readonly resolveImage: (path: string) => string | undefined
  readonly output: ChatGalleryImage[]
}): void => {
  const block = input.block
  const path = block.name === 'read_image' ? block.args.text('file_path') ?? block.args.text('path') : undefined
  const image = 'kind' in block && block.kind === 'tool-result'
    ? block.content.find(content => content.type === 'image')
    : undefined
  if (path !== undefined && image !== undefined) {
    input.output.push({
      turn: input.turn,
      time: block.time,
      path,
      ...loadedImage({ attachment: image.attachment, path, loadImage: input.loadImage }),
    })
  } else if (path !== undefined) {
    const src = input.resolveImage(path)
    if (src !== undefined) input.output.push({ turn: input.turn, time: block.time, path, image: { src, alt: basename(path) } })
  } else if ('kind' in block && block.kind === 'tool-result') {
    appendContentImages({
      content: block.content,
      turn: input.turn,
      time: block.time,
      loadImage: input.loadImage,
      output: input.output,
    })
  }
  for (const subCall of block.subCalls) {
    appendToolImages({
      block: subCall,
      turn: input.turn,
      loadImage: input.loadImage,
      resolveImage: input.resolveImage,
      output: input.output,
    })
  }
}

export const collectChatGalleryImages = (input: {
  readonly nodes: readonly ImageGalleryNode[]
  readonly loadImage: MessageImageLoader
  readonly resolveImage: (path: string) => string | undefined
}): readonly ChatGalleryImage[] => {
  const images: ChatGalleryImage[] = []
  for (const node of input.nodes) {
    if (node.kind === 'assistant-step') {
      for (const block of node.data.blocks) {
        if (block.kind !== 'image') continue
        images.push({
          turn: node.turn,
          time: node.data.time,
          ...loadedImage({ attachment: block.attachment, loadImage: input.loadImage }),
        })
      }
      continue
    }
    if (node.kind === 'user' || node.kind === 'steering' || node.kind === 'context' || node.kind === 'turn-trigger') {
      appendContentImages({
        content: node.data.content,
        turn: node.turn,
        time: node.data.time,
        loadImage: input.loadImage,
        output: images,
      })
      continue
    }
    appendToolImages({
      block: node.data.root,
      turn: node.turn,
      loadImage: input.loadImage,
      resolveImage: input.resolveImage,
      output: images,
    })
  }
  return images.sort((left, right) => left.time - right.time)
}

export const selectChatImageGallery = (input: {
  readonly images: readonly ChatGalleryImage[]
  readonly scope: ImageGalleryScope
  readonly selectedPath?: string
  readonly resolvePath: (path: string) => string
  readonly fallbackImage: LightboxImage
}): ImageGallerySelection => {
  const normalizedPath = input.selectedPath === undefined ? undefined : input.resolvePath(input.selectedPath)
  const selected = normalizedPath === undefined
    ? undefined
    : input.images.findLast(image => image.path !== undefined && input.resolvePath(image.path) === normalizedPath)
  if (selected !== undefined) {
    const images = input.scope === 'thread'
      ? input.images
      : input.images.filter(image => image.turn === selected.turn)
    return {
      images: images.map(image => image.image),
      initialIndex: images.indexOf(selected),
      loaders: images.map(image => image.load),
    }
  }
  if (input.scope === 'thread' && input.images.length > 0) {
    const images = input.images.map(image => image.image)
    const matching = images.findIndex(image => image.src !== undefined && image.src === input.fallbackImage.src)
    if (matching >= 0) {
      return {
        images,
        initialIndex: matching,
        loaders: input.images.map(image => image.load),
      }
    }
    return {
      images: [...images, input.fallbackImage],
      initialIndex: images.length,
      loaders: [...input.images.map(image => image.load), undefined],
    }
  }
  return { images: [input.fallbackImage], initialIndex: 0, loaders: [undefined] }
}
