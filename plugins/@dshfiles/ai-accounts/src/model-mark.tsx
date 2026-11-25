import { BoxIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { KIND_ACCENT } from './account-labels.js'
import { ProviderGlyph } from './provider-glyph.js'

/**
 * Provider marks where a model or a built-in provider is named (council round 2, D4). OpenAI, Claude and Mistral reuse
 * the account glyphs; the DeepSeek and Gemini paths are vendored from `@lobehub/icons` (MIT) through
 * `model-effort-picker/src/brand-marks.ts`, never edited by hand. Follow-up: one shared brand-mark module in the kit.
 */
const DEEPSEEK_PATH =
  'M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z'

const GEMINI_PATHS = [
  'M23 12.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124 1.014-.797 2.542-2.294 3.569l-.021.136 3.332 2.53.23.022C21.779 18.417 23 15.593 23 12.245z',
  'M12.225 23c3.03 0 5.574-.978 7.433-2.665l-3.542-2.688c-.948.648-2.22 1.1-3.891 1.1a6.745 6.745 0 01-6.386-4.572l-.132.011-3.465 2.628-.045.124C4.043 20.531 7.835 23 12.225 23z',
  'M5.84 14.175A6.65 6.65 0 015.463 12c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831 10.831 0 001 12c0 1.772.436 3.447 1.197 4.938l3.642-2.763z',
  'M12.225 5.253c2.108 0 3.529.892 4.34 1.638l3.167-3.031C17.787 2.088 15.255 1 12.225 1 7.834 1 4.043 3.469 2.197 7.062l3.63 2.763a6.77 6.77 0 016.398-4.572z',
] as const

export type ModelFamily = 'openai' | 'claude' | 'google' | 'deepseek' | 'mistral'

/** Tokens that name a family; a model id carries at least one of them (`deepseek/deepseek-v4-flash`, `gpt-6-luna`). */
const FAMILY_TOKENS: readonly { readonly family: ModelFamily; readonly tokens: readonly string[] }[] = [
  { family: 'openai', tokens: ['gpt', 'chatgpt', 'openai', 'codex'] },
  { family: 'claude', tokens: ['claude', 'anthropic', 'haiku', 'sonnet', 'opus'] },
  { family: 'google', tokens: ['gemini', 'google', 'gemma'] },
  { family: 'deepseek', tokens: ['deepseek'] },
  { family: 'mistral', tokens: ['mistral', 'devstral', 'codestral', 'magistral'] },
]

export const modelFamily = (modelId: string): ModelFamily | undefined => {
  for (const token of modelId.toLowerCase().split(/[^a-z0-9]+/u)) {
    if (/^o[1-9]$/u.test(token)) return 'openai'
    const family = FAMILY_TOKENS.find(entry => entry.tokens.some(candidate => token === candidate || token.startsWith(candidate)))?.family
    if (family !== undefined) return family
  }
  return undefined
}

/**
 * DeepSeek's blue: the nearest brand blue the account palette already holds (DeepSeek's own is #4D6BFE); a value of its
 * own belongs in the shared brand-mark module, not in a new raw colour here.
 */
const DEEPSEEK_BLUE = KIND_ACCENT['opencode-go']

const DeepSeekGlyph = (props: { readonly className?: string; readonly color?: string }): JSX.Element => (
  <svg aria-hidden className={props.className} style={{ color: props.color ?? DEEPSEEK_BLUE }} viewBox="0 0 24 24">
    <path d={DEEPSEEK_PATH} fill="currentColor" />
  </svg>
)

const GeminiGlyph = (props: { readonly className?: string }): JSX.Element => (
  <svg aria-hidden className={props.className} style={{ color: KIND_ACCENT.antigravity }} viewBox="0 0 24 24">
    {GEMINI_PATHS.map(path => (
      <path key={path} d={path} fill="currentColor" />
    ))}
  </svg>
)

/** The family's mark: OpenAI, Claude and Mistral reuse the account glyphs. */
const FamilyGlyph = (props: { readonly family: ModelFamily }): JSX.Element => {
  switch (props.family) {
    case 'openai':
      return <ProviderGlyph kind="codex" className="dshx:size-4" />
    case 'claude':
      return <ProviderGlyph kind="claude" className="dshx:size-4" />
    case 'mistral':
      return <ProviderGlyph kind="mistral" className="dshx:size-4" />
    case 'deepseek':
      return <DeepSeekGlyph className="dshx:size-4" />
    case 'google':
      return <GeminiGlyph className="dshx:size-4" />
  }
}

/** A 16 px mark before a model id; an unknown family keeps the same empty seat, so the ids stay aligned. */
export const ModelMark = (props: { readonly modelId: string }): JSX.Element => {
  const family = modelFamily(props.modelId)
  return (
    <span aria-hidden data-model-mark={family ?? 'none'} className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center">
      {family === undefined ? null : <FamilyGlyph family={family} />}
    </span>
  )
}

/** A built-in provider's 32 px tile, like an account's: the DeepSeek mark for DeepSeek, a neutral cube otherwise. */
export const NativeProviderMark = (props: { readonly label: string }): JSX.Element => {
  const deepseek = modelFamily(props.label) === 'deepseek'
  return (
    <span
      aria-hidden
      data-native-provider-mark={deepseek ? 'deepseek' : 'generic'}
      className={cn(
        'dshx:grid dshx:shrink-0 dshx:place-items-center dshx:rounded-lg',
        'dshx:size-8',
        deepseek ? 'dshx:text-primary-foreground' : 'dshx:bg-muted dshx:text-muted-foreground',
      )}
      style={deepseek ? { backgroundColor: DEEPSEEK_BLUE } : undefined}
    >
      {deepseek ? <DeepSeekGlyph className="dshx:size-5" color="white" /> : <BoxIcon className="dshx:size-4" />}
    </span>
  )
}
