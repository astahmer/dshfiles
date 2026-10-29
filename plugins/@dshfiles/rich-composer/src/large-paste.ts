/** A paste this large goes in as a text file instead of flooding the draft. */
const LARGE_PASTE_BYTES = 32 * 1024

const isLarge = (text: string): boolean => text.length * 3 >= LARGE_PASTE_BYTES && new TextEncoder().encode(text).byteLength >= LARGE_PASTE_BYTES

const twoDigits = (value: number): string => String(value).padStart(2, '0')

/** `pasted-20261029-213751.txt`, in local time so it matches the clock the person sees. */
const fileNameAt = (at: Date): string =>
  `pasted-${at.getFullYear()}${twoDigits(at.getMonth() + 1)}${twoDigits(at.getDate())}-${twoDigits(at.getHours())}${twoDigits(at.getMinutes())}${twoDigits(at.getSeconds())}.txt`

const fileFor = (input: { readonly text: string; readonly at: Date }): File =>
  new File([input.text], fileNameAt(input.at), { type: 'text/plain', lastModified: input.at.getTime() })

export class LargePasteModel {
  static readonly thresholdBytes = LARGE_PASTE_BYTES
  static readonly isLarge = isLarge
  static readonly fileFor = fileFor
}
