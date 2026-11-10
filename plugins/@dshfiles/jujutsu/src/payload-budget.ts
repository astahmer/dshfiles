const utf8 = new TextEncoder()

/** dshx refuses a JSON response over 1 MiB, so a plugin answer leaves room for its envelope under that cap. */
export const API_PAYLOAD_BYTE_BUDGET = 960 * 1024

/** Marks text cut to fit the payload budget, as opposed to text cut by the jj output limit. */
export const PAYLOAD_TRUNCATION_NOTE = '\n[diff truncated to fit the API payload limit]'

/** Keeps a large text response (a revision patch) inside the dshx JSON budget instead of failing the whole read. */
export class PayloadBudget {
  static encodedBytes<Value>(value: Value): number {
    return utf8.encode(JSON.stringify(value) ?? '').byteLength
  }

  /**
   * The largest line-aligned prefix of `text` whose enclosing response still fits `budgetBytes`; a response that already
   * fits is returned untouched, so ordinary revisions keep their whole patch.
   */
  static fitText<Response>(input: { readonly text: string; readonly response: (text: string) => Response; readonly budgetBytes?: number | undefined }) {
    const budget = input.budgetBytes ?? API_PAYLOAD_BYTE_BUDGET
    const whole = input.response(input.text)
    if (PayloadBudget.encodedBytes(whole) <= budget) return { text: input.text, response: whole, truncated: false }
    const candidate = (length: number): string => input.text.slice(0, length) + PAYLOAD_TRUNCATION_NOTE
    let fitting = 0
    let over = input.text.length - 1
    while (fitting < over) {
      const middle = Math.ceil((fitting + over) / 2)
      if (PayloadBudget.encodedBytes(input.response(candidate(middle))) <= budget) fitting = middle
      else over = middle - 1
    }
    const lineEnd = fitting === 0 ? -1 : input.text.lastIndexOf('\n', fitting)
    const text = (lineEnd > 0 ? input.text.slice(0, lineEnd) : input.text.slice(0, fitting)) + PAYLOAD_TRUNCATION_NOTE
    return { text, response: input.response(text), truncated: true }
  }
}
