const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

/** UTF-8 byte arithmetic on JS strings without TextEncoder, so the core stays runtime-agnostic. */
export class Utf8 {
  static readonly ellipsis = '…'

  static byteLength(text: string): number {
    let bytes = 0
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code < 0x80) bytes += 1
      else if (code < 0x800) bytes += 2
      else if (isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))) {
        bytes += 4
        index++
      } else bytes += 3
    }
    return bytes
  }

  /** Longest prefix of at most `maxBytes` that never splits a code point. */
  static head(text: string, maxBytes: number): string {
    let bytes = 0
    let index = 0
    while (index < text.length) {
      const code = text.charCodeAt(index)
      const pair = isHighSurrogate(code) && isLowSurrogate(text.charCodeAt(index + 1))
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3
      if (bytes + size > maxBytes) break
      bytes += size
      index += pair ? 2 : 1
    }
    return text.slice(0, index)
  }

  /** Longest suffix of at most `maxBytes` that never splits a code point. */
  static tail(text: string, maxBytes: number): string {
    let bytes = 0
    let index = text.length
    while (index > 0) {
      const code = text.charCodeAt(index - 1)
      const pair = isLowSurrogate(code) && index > 1 && isHighSurrogate(text.charCodeAt(index - 2))
      const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3
      if (bytes + size > maxBytes) break
      bytes += size
      index -= pair ? 2 : 1
    }
    return text.slice(index)
  }

  /** Deterministic cut to `maxBytes` including a trailing ellipsis. */
  static clip(text: string, maxBytes: number): string {
    if (Utf8.byteLength(text) <= maxBytes) return text
    return Utf8.head(text, maxBytes - Utf8.byteLength(Utf8.ellipsis)) + Utf8.ellipsis
  }

  /** Keeps head and tail around an explicit marker so the result stays within `maxBytes`. */
  static boundHeadTail(text: string, maxBytes: number): { readonly text: string; readonly truncatedBytes: number } {
    const total = Utf8.byteLength(text)
    if (total <= maxBytes) return { text, truncatedBytes: 0 }
    const markerBudget = 48
    const keep = Math.max(0, maxBytes - markerBudget)
    const head = Utf8.head(text, Math.ceil(keep / 2))
    const tail = Utf8.tail(text, keep - Utf8.byteLength(head))
    const truncatedBytes = total - Utf8.byteLength(head) - Utf8.byteLength(tail)
    return { text: `${head}\n…[truncated ${truncatedBytes} bytes]…\n${tail}`, truncatedBytes }
  }

  static pages(text: string, pageBytes: number): readonly string[] {
    const pages: string[] = []
    let rest = text
    while (rest.length > 0) {
      const page = Utf8.head(rest, pageBytes)
      const safePage = page.length > 0 ? page : rest.slice(0, 1)
      pages.push(safePage)
      rest = rest.slice(safePage.length)
    }
    return pages.length > 0 ? pages : ['']
  }
}
