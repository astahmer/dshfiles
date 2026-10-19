const MAX_REFERENCES = 20

const mentionPattern = /(?<![\w/])b:(\d+)\b/g
const closingPattern = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|complete[sd]?|implement(?:s|ed)?)\b[:\s]+((?:b:\d+(?:\s*(?:,|and)\s*)?)+)/gi

/** Item ids mentioned anywhere in a message: `b:12`. */
const mentionsIn = (text: string): number[] =>
  [...new Set([...text.matchAll(mentionPattern)].map(match => Number(match[1])))].filter(id => id > 0).slice(0, MAX_REFERENCES)

/**
 * Item ids a revision description closes, with the Linear and GitHub magic words: `Closes b:12`, `fixes b:3 and b:4`.
 * A bare mention (`part of b:12`) closes nothing.
 */
const closedBy = (description: string): number[] =>
  [...new Set([...description.matchAll(closingPattern)].flatMap(match => mentionsIn(match[1] ?? '')))].slice(0, MAX_REFERENCES)

/** One `jj log` record per revision: change id, a tab, the full description, then a record separator. */
const parseLog = (stdout: string): { readonly changeId: string; readonly description: string }[] =>
  stdout
    .split('\u001e')
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record.includes('\t'))
    .map(record => {
      const tab = record.indexOf('\t')
      return { changeId: record.slice(0, tab).trim(), description: record.slice(tab + 1) }
    })
    .filter(record => /^[a-z]{8,}$/.test(record.changeId))

export class BacklogSignals {
  /** `jj log` template matching {@link parseLog}. */
  static readonly logTemplate = 'change_id.short(12) ++ "\\t" ++ description ++ "\\x1e"'
  static readonly mentionsIn = mentionsIn
  static readonly closedBy = closedBy
  static readonly parseLog = parseLog
}
