const TITLE_CHARS = 80

const titleOf = (text: string): string => {
  const firstLine =
    text
      .split('\n')
      .find(line => line.trim() !== '')
      ?.trim() ?? ''
  const plain = firstLine.replace(/^[#>*\-\s]+/u, '').trim()
  return plain.length <= TITLE_CHARS ? plain : `${plain.slice(0, TITLE_CHARS - 1).trimEnd()}…`
}

/**
 * The capture a quoted reply opens with: its first line as the title, the whole reply as a Markdown quote, and the
 * thread id, which capture turns into a link back to the conversation.
 */
const captureText = (input: { readonly text: string; readonly sessionId: string }): string => {
  const quote = input.text
    .trim()
    .split('\n')
    .map(line => (line === '' ? '>' : `> ${line}`))
    .join('\n')
  return `${titleOf(input.text)}\n\n${quote}\n\nFrom ${input.sessionId}`
}

export class MessageQuote {
  static readonly captureText = captureText
}
