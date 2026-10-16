const blockElements = new Set(['ARTICLE', 'BLOCKQUOTE', 'DIV', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'UL'])
const ignoredElements = new Set(['SCRIPT', 'STYLE', 'TEMPLATE'])

const appendBlockBreak = (parts: string[]): void => {
  const last = parts.at(-1)
  if (last !== undefined && !last.endsWith('\n')) parts.push('\n')
}

export const clipboardHtmlToText = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const parts: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '')
      return
    }
    if (!(node instanceof Element) || ignoredElements.has(node.tagName)) return
    if (node.tagName === 'BR') {
      parts.push('\n')
      return
    }
    if (node.tagName === 'A') {
      const reference = node.getAttribute('href')
      if (reference?.startsWith('dsh-session:') === true) {
        const label = node.textContent?.trim() ?? ''
        if (label !== '') {
          parts.push(`@[${label}](${reference})`)
          return
        }
      }
    }
    if (blockElements.has(node.tagName)) appendBlockBreak(parts)
    for (const child of node.childNodes) visit(child)
    if (blockElements.has(node.tagName)) appendBlockBreak(parts)
  }
  for (const child of document.body.childNodes) visit(child)
  return parts.join('').replaceAll(/\n{3,}/gu, '\n\n')
}

export const clipboardText = (data: Pick<DataTransfer, 'getData'>): string => {
  const plainText = data.getData('text/plain')
  if (plainText !== '') return plainText
  const html = data.getData('text/html')
  return html === '' ? '' : clipboardHtmlToText(html)
}
