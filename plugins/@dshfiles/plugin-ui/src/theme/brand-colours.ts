/**
 * Model-family brand colours for `components/model-mark` (council round 5 D1): the colour each provider's own mark is
 * drawn in, so a model reads the same in AI accounts and in Usage. They are brand artwork, not UI tones: never a fill,
 * a text colour or a status. The values match `ai-accounts`' account accents (follow-up: one source for both).
 */
export const BRAND_COLOURS = {
  openai: '#10A37F',
  claude: '#D97757',
  mistral: '#FA520F',
  /** DeepSeek's own blue is #4D6BFE; the accounts palette's nearest blue keeps one value across the app. */
  deepseek: '#3B82F6',
  google: '#4285F4',
} as const
