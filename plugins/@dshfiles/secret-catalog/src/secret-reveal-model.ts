export type SecretRevealStage = 'preview' | 'full'

export const nextSecretRevealStage = (stage: SecretRevealStage): SecretRevealStage | null =>
  stage === 'preview' ? 'full' : null

export const previewSecretValue = (value: string): string => {
  if (value.length <= 12) return `${'•'.repeat(8)} (${value.length} chars)`
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
