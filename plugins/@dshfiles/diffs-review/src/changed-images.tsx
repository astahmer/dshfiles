import type { ImagePreviewRefusal } from '@dshfiles/image-preview'
import { useImagePreview } from '@dshfiles/image-preview/react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { ImageIcon } from '@dshfiles/plugin-ui/icons'
import type { ReactNode } from 'react'
import type { ChangedImageEntry, ImageSide } from './review-image-query.js'

const NOTE =
  'dshx:flex dshx:min-h-24 dshx:flex-wrap dshx:items-center dshx:justify-center dshx:gap-2 dshx:p-3 dshx:text-center dshx:text-xs dshx:text-muted-foreground'

const refusalText = {
  missing: 'Not in this version. Refresh the review if the file moved since.',
  'too-large': 'Larger than the 8 MB preview cap. Open the file to see it.',
  outside: 'This image resolves outside the reviewed repository, so it is not shown.',
  'not-an-image': 'Only image files are previewed.',
} satisfies Record<ImagePreviewRefusal, string>

/** One version of an image, read from its route into a blob URL: an SVG renders as an image, never as a document. */
const Side = (props: { readonly side: ImageSide; readonly alt: string }): JSX.Element => {
  const { state, retry } = useImagePreview(props.side.url)
  const body = (): ReactNode => {
    if (state.kind === 'loading')
      return (
        <p className={NOTE} role="status">
          <Spinner /> Reading image…
        </p>
      )
    if (state.kind === 'refused') return <p className={NOTE}>{refusalText[state.refusal]}</p>
    if (state.kind === 'error')
      return (
        <p className={NOTE} role="alert">
          <span>This image could not be read.</span>
          <Button onClick={retry} size="xs" type="button" variant="outline">
            Try again
          </Button>
        </p>
      )
    return <img alt={props.alt} className="dshx:mx-auto dshx:block dshx:max-h-80 dshx:max-w-full dshx:object-contain" src={state.src} />
  }
  return (
    <figure className="dshx:m-0 dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-1" data-image-side={props.side.label}>
      <figcaption className="dshx:text-2xs dshx:text-muted-foreground">{props.side.label}</figcaption>
      <div className="dshx:overflow-hidden dshx:rounded-md dshx:border dshx:border-border dshx:bg-muted/40 dshx:p-1">{body()}</div>
    </figure>
  )
}

/**
 * The changed images of a review, each with the versions that exist side by side: before and after when both sides are
 * known revisions, else the one there is, labelled.
 */
export const ChangedImages = (props: {
  readonly images: readonly ChangedImageEntry[]
  readonly renderActions?: ((path: string) => ReactNode) | undefined
}): JSX.Element | null => {
  if (props.images.length === 0) return null
  return (
    <ul aria-label="Changed images" className="dshx:flex dshx:flex-col dshx:gap-2" data-testid="changed-images">
      {props.images.map(image => (
        <li
          className="dshx:flex dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:p-2"
          data-changed-image={image.path}
          key={image.path}
        >
          <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <ImageIcon aria-hidden className="dshx:size-3.5 dshx:shrink-0 dshx:text-muted-foreground" />
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-mono dshx:text-xs">{image.path}</span>
            {props.renderActions?.(image.path)}
          </div>
          <div
            className={
              image.before !== undefined && image.after !== undefined
                ? 'dshx:grid dshx:grid-cols-1 dshx:gap-2 dshx:@md:grid-cols-2'
                : 'dshx:grid dshx:grid-cols-1'
            }
          >
            {image.before === undefined ? null : <Side alt={`${image.path}, ${image.before.label}`} side={image.before} />}
            {image.after === undefined ? null : <Side alt={`${image.path}, ${image.after.label}`} side={image.after} />}
          </div>
        </li>
      ))}
    </ul>
  )
}
