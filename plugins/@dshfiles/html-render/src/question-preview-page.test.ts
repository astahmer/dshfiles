import { describe, expect, it } from 'vitest'
import { HtmlPageLimits } from './html-page.js'
import { QUESTION_PREVIEW_HEIGHT, questionPreviewPage } from './question-preview-page.js'

describe('question html preview', () => {
  it('renders a question preview as an auto-themed page sized for the question card', () => {
    expect(questionPreviewPage({ caption: 'Revenue', html: '<b>hi</b>' })).toEqual({
      page: { title: 'Revenue', html: '<b>hi</b>', height: QUESTION_PREVIEW_HEIGHT, theme: 'auto' },
    })
  })

  it('refuses a preview over the html_render cap with a recovery path', () => {
    const result = questionPreviewPage({ caption: 'Big', html: 'x'.repeat(HtmlPageLimits.maxHtmlBytes + 1) })
    expect('reason' in result && result.reason).toMatch(/at most 512\.0 KB.*shrink it or publish it with html_render/)
  })
})
