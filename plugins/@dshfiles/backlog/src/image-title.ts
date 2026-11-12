/** The doodle the composer writes for an attached image: `dsh-context://v1/image/image_<attachment id>`. */
const IMAGE_REFERENCE = /!\[(?:\\.|[^\]\\])*\]\(dsh-context:\/\/v1\/image\/([^()\s]+)\)/gu

const attachmentIdOf = (target: string): string => target.replace(/^image_/u, '')

const imageReferences = (text: string): readonly string[] => [...text.matchAll(IMAGE_REFERENCE)].flatMap(match => (match[1] === undefined ? [] : [match[1]]))

export const imageTitleFallback = (title: string): string => {
  const image = /^\s*!\[((?:\\.|[^\]\\])*)\]\([^()\n]+\)\s*$/u.exec(title)
  if (image === null) return title
  const label = (image[1] ?? '').replace(/\\([\\\]])/gu, '$1').trim()
  return label === '' ? 'Image' : `Image: ${label}`
}

/** Whether the title is only image references: the capture carried an image and no words worth keeping. */
const isImageOnlyTitle = (title: string): boolean => title.replace(IMAGE_REFERENCE, '').trim() === '' && imageReferences(title).length > 0

/** What an item's title shows, so a title written from the image still finds it: the first image of its title, else its first image attachment. */
const imageAttachmentIdOf = (input: {
  readonly title: string
  readonly attachments: readonly { readonly id: string; readonly kind: string }[]
}): string | undefined => {
  const fromTitle = imageReferences(input.title)[0]
  const id = fromTitle === undefined ? undefined : attachmentIdOf(fromTitle)
  if (id !== undefined && input.attachments.some(attachment => attachment.id === id)) return id
  return input.attachments.find(attachment => attachment.kind === 'image')?.id
}

/** A model answer cut down to a title: one line, no heading, quotes, label or trailing punctuation, at most 8 words. */
const toShortTitle = (text: string): string => {
  const line = text
    .split('\n')
    .map(candidate => candidate.trim())
    .find(candidate => candidate !== '')
  const cleaned = (line ?? '')
    .replace(/^#{1,6}\s*/u, '')
    .replace(/^title\s*:\s*/iu, '')
    .replace(/[*_`]+/gu, '')
    .replace(/^["'“”]|["'“”]$/gu, '')
    .trim()
    .replace(/[.,;:!?]+$/u, '')
    .trim()
  return cleaned.split(/\s+/u).slice(0, 8).join(' ').slice(0, 80)
}

/** The one short model call that names an image-only item, in the user's own voice. */
const prompt = {
  system:
    'You name backlog items for a developer. The user captured a screenshot and wrote no text. Answer with a title only: at most 8 words, no quotes, no Markdown, no trailing period. Name the screen, error or change the image shows, as the user would say it. Never invent details the image does not show.',
  input: 'Name this backlog item from its image.',
} as const

export class ImageTitleModel {
  static readonly isImageOnlyTitle = isImageOnlyTitle
  static readonly imageAttachmentIdOf = imageAttachmentIdOf
  static readonly toShortTitle = toShortTitle
  static readonly prompt = prompt
}
