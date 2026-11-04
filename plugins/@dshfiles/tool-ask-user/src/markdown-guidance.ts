/**
 * dshfiles delta: the model-facing description text for markdown questions. The `@dshfiles/user-questions` form
 * renders `question` and option `description` as markdown and hands ```html preview fences to the sandboxed
 * `@dshfiles/html-render` card; this text is the only place the model learns that. The schema itself is unchanged.
 */

/** Appended to the tool description, in both the legacy and the timed mode. */
export const MARKDOWN_GUIDANCE =
  'Question text and option descriptions are Markdown: when a choice is easier to make by seeing it, show it, ' +
  'with links, images, tables, code blocks or a sandboxed HTML view; keep each question answerable on its own.'

/** The `question` field. */
export const QUESTION_DESCRIPTION =
  'The specific question to ask the user, as Markdown. The first paragraph is the heading, so lead with a short ' +
  'line; later paragraphs may hold links, images (an absolute local file path or an https URL), tables, fenced ' +
  'code and $math$. A fenced block whose info string is `html preview` (optionally followed by a title, e.g. ' +
  '```html preview Revenue by month) renders as an interactive HTML view for a chart, mockup or diagram. It runs in ' +
  'a sandboxed frame with no network and no same-origin access: inline all CSS, JavaScript and images (data: URIs); ' +
  'external scripts, stylesheets, fonts, images and fetch are blocked, and it cannot read DSH or its storage. ' +
  'A plain ```html fence shows code, not a page.'

/** An option's `description` field. */
export const OPTION_DESCRIPTION = 'One sentence explaining the tradeoff or impact; inline Markdown (bold, `code`, links) is rendered.'
