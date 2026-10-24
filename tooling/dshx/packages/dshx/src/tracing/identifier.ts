const IDENTIFIER = /^[\w.:/@+-]{1,128}$/u

/**
 * A value safe to record as an identity (a tool, model, provider, package or panel name): kept when it is one bounded
 * token of letters, digits and `_ . : / @ + -`, otherwise `undefined`, so free text (prompts, paths with spaces,
 * messages) never becomes an attribute by accident. Runtime-neutral: the Host and browser tracers share it.
 */
export const redactIdentifier = (value: string | undefined): string | undefined => (value !== undefined && IDENTIFIER.test(value) ? value : undefined)
