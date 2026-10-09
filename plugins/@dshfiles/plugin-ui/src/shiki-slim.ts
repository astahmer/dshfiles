import type { DynamicImportLanguageRegistration } from 'shiki/core'
import { createBundledHighlighter, createSingletonShorthands } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export { createCssVariablesTheme, getTokenStyleObject, stringifyTokenStyle } from 'shiki/core'
export { createJavaScriptRegexEngine }

const typescript: DynamicImportLanguageRegistration = () => import('@shikijs/langs/typescript')
const tsx: DynamicImportLanguageRegistration = () => import('@shikijs/langs/tsx')
const shellscript: DynamicImportLanguageRegistration = () => import('@shikijs/langs/shellscript')
const markdown: DynamicImportLanguageRegistration = () => import('@shikijs/langs/markdown')
const yaml: DynamicImportLanguageRegistration = () => import('@shikijs/langs/yaml')
const docker: DynamicImportLanguageRegistration = () => import('@shikijs/langs/docker')

/**
 * Grammars a single-file plugin bundle can afford. Shiki's full `bundledLanguages` inlines ~8 MB of grammars
 * because dshx emits one client module. JavaScript reuses the TypeScript grammars, which highlight it correctly.
 * Grammars that embed others (HTML, GraphQL, Lua, XML) stay out because each drags in a second large grammar.
 */
export const bundledLanguages: Record<string, DynamicImportLanguageRegistration> = {
  typescript,
  ts: typescript,
  mts: typescript,
  cts: typescript,
  javascript: typescript,
  js: typescript,
  mjs: typescript,
  cjs: typescript,
  tsx,
  jsx: tsx,
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  markdown,
  md: markdown,
  yaml,
  yml: yaml,
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  shellscript,
  shell: shellscript,
  bash: shellscript,
  sh: shellscript,
  zsh: shellscript,
  nix: () => import('@shikijs/langs/nix'),
  rust: () => import('@shikijs/langs/rust'),
  go: () => import('@shikijs/langs/go'),
  python: () => import('@shikijs/langs/python'),
  sql: () => import('@shikijs/langs/sql'),
  make: () => import('@shikijs/langs/make'),
  diff: () => import('@shikijs/langs/diff'),
  docker,
  dockerfile: docker,
}

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: {},
  engine: () => createJavaScriptRegexEngine(),
})

export const { codeToHtml } = createSingletonShorthands(createHighlighter)

/** The Oniguruma WASM engine is ~620 kB inlined; the JavaScript regex engine covers every grammar above. */
export const createOnigurumaEngine = (): ReturnType<typeof createJavaScriptRegexEngine> => createJavaScriptRegexEngine()
