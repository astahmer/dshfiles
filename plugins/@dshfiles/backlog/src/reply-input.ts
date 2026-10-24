export const replyTextAtSubmit = (input: { readonly value: string } | null, controlledText: string): string => input?.value ?? controlledText
