import type { ShellTranslate } from './locales.js'

/** English and 中文 are the languages every dshfiles plugin carries (DESIGN.md › Language). */
const coveredLanguage = (locale: string): boolean => {
  const primary = locale.toLowerCase().split('-')[0]
  return primary === 'en' || primary === 'zh'
}

/**
 * Round three item 30: under Settings › General › Language, one muted line says what a language other than English and
 * 中文 covers, so a French or Japanese screen that is half English reads as expected rather than broken. It names
 * English as the fix by implication; nothing renders in the two covered languages.
 */
export const LanguageCoverageNote = (props: { readonly locale: string; readonly t: ShellTranslate }): JSX.Element | null =>
  coveredLanguage(props.locale) ? null : (
    <p
      className="dshx:m-0 dshx:border-b-[0.5px] dshx:border-[var(--dsw-alias-border-l2)] dshx:pb-4 dshx:text-xs dshx:leading-[18px] dshx:text-muted-foreground"
      data-settings-entry="language-note"
      data-settings-language-note=""
    >
      {props.t('general.languageNote')}
    </p>
  )
