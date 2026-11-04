import type { QuestionHtmlPreviewProps } from '@dshfiles/user-questions/html-preview'
import { useMemo } from 'react'
import { HtmlPageCard, HtmlPageFailed } from './html-page-card.js'
import { questionPreviewPage } from './question-preview-page.js'

/**
 * The question form's ```html preview block: the same sandboxed, themed card as html_render (scripts without
 * same-origin, a no-network Content-Security-Policy), sized for the question card.
 */
export const QuestionHtmlPreviewCard = (props: QuestionHtmlPreviewProps): JSX.Element => {
  const result = useMemo(() => questionPreviewPage(props), [props])
  if ('reason' in result) return <HtmlPageFailed reason={result.reason} pageTitle={props.caption} />
  return <HtmlPageCard page={result.page} />
}
