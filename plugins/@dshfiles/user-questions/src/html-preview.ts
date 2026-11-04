import { defineRegistry } from '@dshfiles/dshx/client'
import type { ComponentType } from 'react'

/** One ```` ```html preview ```` block of a question, as the question form hands it to a renderer. */
export interface QuestionHtmlPreviewProps {
  /** The fence's markup, untrusted agent text. */
  readonly html: string
  /** Accessible name and caption: the fence's title, else the question's header or heading. */
  readonly caption: string
}

/**
 * Renders a question's HTML preview. The question form owns the screen and declares this token; a plugin that can
 * isolate untrusted markup (`@dshfiles/html-render`, a sandboxed iframe with no network and no same-origin access)
 * provides it with `api.add(QuestionHtmlPreview, { Component })`. Without a provider the form shows the markup as a
 * code block, so a preview never runs outside a sandbox.
 */
export interface QuestionHtmlPreviewRenderer {
  readonly Component: ComponentType<QuestionHtmlPreviewProps>
}

export const QuestionHtmlPreview = defineRegistry<QuestionHtmlPreviewRenderer>('@dshfiles/user-questions.html-preview')
