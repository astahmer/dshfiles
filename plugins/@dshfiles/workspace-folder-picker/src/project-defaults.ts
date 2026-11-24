/**
 * Where the Create project dialog starts. A remembered parent wins over the Host home, and a blank one falls back to home
 * so the field is never empty on first use.
 */
export const initialProjectParent = (input: { readonly defaultParent?: string | undefined; readonly home?: string | undefined }): string => {
  const remembered = input.defaultParent?.trim() ?? ''
  if (remembered !== '') return remembered
  return input.home ?? '~/'
}
