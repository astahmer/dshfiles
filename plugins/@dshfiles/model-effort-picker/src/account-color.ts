/** Hues an account falls back to when it carries no usable accent; distinct in both themes. */
export const ACCOUNT_HUES = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#84CC16', '#F97316'] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/iu

/** The dot that identifies an account everywhere in the picker: its own accent, else a stable hue. */
export const accountColor = ({ instanceId, accentColor }: { readonly instanceId: string; readonly accentColor?: string | undefined }): string => {
  if (accentColor !== undefined && HEX_COLOR.test(accentColor)) return accentColor
  let hash = 0
  for (const character of instanceId) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return ACCOUNT_HUES[hash % ACCOUNT_HUES.length] ?? ACCOUNT_HUES[0]
}
