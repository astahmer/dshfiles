import type { QuestionHtmlPreviewProps } from '@dshfiles/user-questions/html-preview'
import { HtmlPageLimits, HtmlPageModel, type HtmlPage } from './html-page.js'

/** Fits the question card's scroll seat (capped at 520 px) with room for its options under it. */
export const QUESTION_PREVIEW_HEIGHT = 220

/** A question's preview as the page the card renders, or the reason it is refused (same cap as html_render). */
export const questionPreviewPage = (props: QuestionHtmlPreviewProps): { readonly page: HtmlPage } | { readonly reason: string } => {
  const bytes = HtmlPageModel.byteLength(props.html)
  if (bytes > HtmlPageLimits.maxHtmlBytes) {
    return {
      reason: `The preview is ${HtmlPageModel.formatBytes(bytes)}; at most ${HtmlPageModel.formatBytes(HtmlPageLimits.maxHtmlBytes)} renders. Ask the agent to shrink it or publish it with html_render.`,
    }
  }
  return { page: { title: props.caption, html: props.html, height: QUESTION_PREVIEW_HEIGHT, theme: 'auto' } }
}
