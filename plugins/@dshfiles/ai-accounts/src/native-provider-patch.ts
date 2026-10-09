/**
 * Switching a native provider row off in the profile patch, without touching
 * the row's own configuration.
 *
 * The profile patch is a YAML sequence of Loader patches, and a later patch for
 * the same row id overrides an earlier one field by field. Disabling therefore
 * appends a small, marked patch carrying only `disabled: true`; re-enabling
 * removes exactly that block. Nothing else in the file is rewritten, so the
 * user's comments, the row's config and every credential reference stay as
 * they were. Only blocks this plugin wrote are ever removed.
 */

const MARKER = '# ai-accounts: native provider switch'

const ROW_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/

export const isPatchRowId = (id: string): boolean => ROW_ID.test(id)

/** Rows this plugin disabled, with the label it recorded beside each. */
export const managedDisabledRows = (text: string): Map<string, string> => {
  const rows = new Map<string, string>()
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (!line.startsWith(MARKER)) return
    const id = /^- id: (\S+)$/.exec(lines[index + 1] ?? '')?.[1]
    if (id === undefined || lines[index + 2] !== '  disabled: true') return
    rows.set(
      id,
      line
        .slice(MARKER.length)
        .replace(/^ — /, '')
        .trim() || id,
    )
  })
  return rows
}

/**
 * A block sequence can take an appended item; a flow sequence (`[...]`) or a
 * document that is not a sequence cannot, so those are refused rather than
 * corrupted.
 */
const appendable = (text: string): boolean => {
  const content = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  if (content.length === 0) return true
  return content[0]?.startsWith('- ') === true && text.split('\n').every(line => !/^\S/.test(line) || line.startsWith('- ') || line.startsWith('#'))
}

export const withRowDisabled = (text: string, row: { readonly id: string; readonly label: string }): string => {
  if (!isPatchRowId(row.id)) throw new Error(`Refusing to disable row '${row.id}'.`)
  if (managedDisabledRows(text).has(row.id)) return text
  const normalized = text.trim() === '[]' ? '' : text
  if (!appendable(normalized)) throw new Error('The profile patch is not a plain YAML list, so it was left unchanged. Disable the row by hand.')
  const label = row.label.replaceAll('\n', ' ').trim()
  const separator = normalized === '' || normalized.endsWith('\n') ? '' : '\n'
  return `${normalized}${separator}${MARKER}${label === '' ? '' : ` — ${label}`}\n- id: ${row.id}\n  disabled: true\n`
}

export const withRowEnabled = (text: string, id: string): string => {
  const lines = text.split('\n')
  const kept: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.startsWith(MARKER) && lines[index + 1] === `- id: ${id}` && lines[index + 2] === '  disabled: true') {
      index += 2
      continue
    }
    kept.push(line)
  }
  return kept.join('\n')
}
