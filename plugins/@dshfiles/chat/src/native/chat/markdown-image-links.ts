import type { LinkIconKind } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LightboxImage } from '@dshfiles/plugin-ui/components/image-lightbox'
import type { OpenFileOptions } from '../contract/slots.ts'

const basename = (path: string): string => path.split(/[\\/]/u).at(-1) || path

export const openMarkdownFileLink = (input: {
  readonly path: string
  readonly kind: LinkIconKind
  readonly options: OpenFileOptions | undefined
  readonly resolveImage: (path: string) => string | undefined
  readonly openImage: (image: LightboxImage, path: string) => void
  readonly openFile: (path: string, options: OpenFileOptions | undefined) => void
}): void => {
  const src = input.kind === 'image' ? input.resolveImage(input.path) : undefined
  if (src !== undefined) {
    input.openImage({ src, alt: basename(input.path) }, input.path)
    return
  }
  input.openFile(input.path, input.options)
}

export const openMarkdownExternalLink = (input: {
  readonly href: string
  readonly kind: LinkIconKind | undefined
  readonly openImage: (image: LightboxImage) => void
  readonly openExternalLink: (href: string) => void
}): void => {
  if (input.kind === 'image') {
    const url = new URL(input.href)
    input.openImage({ src: url.href, alt: basename(url.pathname) })
    return
  }
  input.openExternalLink(input.href)
}
