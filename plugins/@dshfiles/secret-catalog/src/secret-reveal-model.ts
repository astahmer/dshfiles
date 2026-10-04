export type SecretRevealStage = 'preview' | 'full'

export type SecretValuePreview =
  | { readonly kind: 'excerpt'; readonly text: string }
  | { readonly kind: 'masked'; readonly mask: string; readonly length: number }

export const nextSecretRevealStage = (stage: SecretRevealStage): SecretRevealStage | null => (stage === 'preview' ? 'full' : null)

export const previewSecretValue = (value: string): SecretValuePreview => {
  if (value.length <= 12) return { kind: 'masked', mask: '•'.repeat(8), length: value.length }
  return { kind: 'excerpt', text: `${value.slice(0, 4)}…${value.slice(-4)}` }
}
