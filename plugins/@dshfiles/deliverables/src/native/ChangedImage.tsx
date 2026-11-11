/** A changed image file's current version, in place of the binary placeholder. */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import diffCss from './FileDiff.module.css'
import css from './ChangedImage.module.css'

type ImageState =
  | { kind: 'loading' }
  | { kind: 'ready'; src: string }
  | { kind: 'refused'; key: 'image.missing' | 'image.tooLarge' | 'image.outside' }
  | { kind: 'error' }

const refusalKey = (status: number): 'image.missing' | 'image.tooLarge' | 'image.outside' | undefined => {
  if (status === 404) return 'image.missing'
  if (status === 413) return 'image.tooLarge'
  if (status === 403) return 'image.outside'
  return undefined
}

/**
 * Read the image once per mount and retry, and show it from a blob URL revoked on unmount.
 * @param props - the image route, its accessible name, and localized copy.
 * @returns the image with its version label, or the reason it cannot be shown with what to do next.
 */
export function ChangedImage({ url, alt, t }: { url: string; alt: string } & PropsLocale<typeof NS>): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ImageState>({ kind: 'loading' })
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({ kind: 'loading' })
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        const key = refusalKey(response.status)
        if (key !== undefined) return setState({ kind: 'refused', key })
        if (!response.ok) return setState({ kind: 'error' })
        objectUrl = URL.createObjectURL(await response.blob())
        if (!controller.signal.aborted) setState({ kind: 'ready', src: objectUrl })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'error' })
      })
    return () => {
      controller.abort()
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl)
    }
  }, [url, attempt])
  if (state.kind === 'loading') return <p className={diffCss.status} role="status">{t('diff.loading')}</p>
  if (state.kind === 'refused') return <p className={diffCss.status} data-changed-image-refused={state.key}>{t(state.key)}</p>
  if (state.kind === 'error') {
    return <div className={diffCss.status}><span>{t('image.error')}</span>
      <Button size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('presented.retry')}</Button></div>
  }
  return <figure className={css.figure} data-changed-image>
    <img className={css.image} src={state.src} alt={alt} />
    <figcaption className={css.caption}>{t('image.current')}</figcaption>
  </figure>
}
