import * as Schema from 'effect/Schema'

/** `z.string().url()`: a string `new URL` parses, kept as the string the API sent. */
const parseableUrl = Schema.makeFilter((value: string) => {
  try {
    void new URL(value)
    return true
  } catch {
    return 'Expected a full URL.'
  }
})

/** A bounded URL string: the shape every post and media reference repeats. */
export const urlString = Schema.String.check(Schema.isMaxLength(2_048)).check(parseableUrl)

/** The same URL string, trimmed first: a pasted post link may arrive padded. */
export const trimmedUrlString = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)).check(parseableUrl)
