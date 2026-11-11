/** A changed image file's current version, in place of the binary placeholder. */
import type { ReactNode } from 'react'
import { useImagePreview } from '@dshfiles/image-preview/react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import diffCss from './FileDiff.module.css'
import css from './ChangedImage.module.css'

const refusalKeys = { missing: 'image.missing', 'too-large': 'image.tooLarge', outside: 'image.outside' } as const

/**
 * Read the image once per mount and retry, and show it from a blob URL revoked on unmount.
 * @param props - the image route, its accessible name, and localized copy.
 * @returns the image with its version label, or the reason it cannot be shown with what to do next.
 */
export function ChangedImage({ url, alt, t }: { url: string; alt: string } & PropsLocale<typeof NS>): ReactNode {
  const { state, retry } = useImagePreview(url)
  if (state.kind === 'loading') return <p className={diffCss.status} role="status">{t('diff.loading')}</p>
  if (state.kind === 'refused' && state.refusal !== 'not-an-image') {
    const key = refusalKeys[state.refusal]
    return <p className={diffCss.status} data-changed-image-refused={key}>{t(key)}</p>
  }
  if (state.kind !== 'ready') {
    return <div className={diffCss.status}><span>{t('image.error')}</span>
      <Button size="sm" onClick={retry}>{t('presented.retry')}</Button></div>
  }
  return <figure className={css.figure} data-changed-image>
    <img className={css.image} src={state.src} alt={alt} />
    <figcaption className={css.caption}>{t('image.current')}</figcaption>
  </figure>
}
