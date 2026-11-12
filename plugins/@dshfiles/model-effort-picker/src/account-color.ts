/**
 * Hues an account falls back to when it carries no usable accent: the kit's categorical tokens (DESIGN.md › Colors),
 * distinct from each other in both themes and retuned with them.
 */
export const ACCOUNT_HUES = [
  'var(--dshx-kit-graph-1)',
  'var(--dshx-kit-graph-2)',
  'var(--dshx-kit-graph-3)',
  'var(--dshx-kit-graph-4)',
  'var(--dshx-kit-graph-5)',
  'var(--dshx-kit-graph-6)',
  'var(--dshx-kit-teal)',
  'var(--dshx-kit-violet)',
] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/iu

/** The dot that identifies an account everywhere in the picker: its own accent, else a stable hue. */
export const accountColor = ({ instanceId, accentColor }: { readonly instanceId: string; readonly accentColor?: string | undefined }): string => {
  if (accentColor !== undefined && HEX_COLOR.test(accentColor)) return accentColor
  let hash = 0
  for (const character of instanceId) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return ACCOUNT_HUES[hash % ACCOUNT_HUES.length] ?? ACCOUNT_HUES[0]
}
