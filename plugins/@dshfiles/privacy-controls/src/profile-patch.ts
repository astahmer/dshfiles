import { isSeq, parseDocument } from 'yaml'
import { privacyFeatures, type PrivacyFeatureId } from './features.js'

const managedMarkerPrefix = '# dshfiles-privacy-controls:v1 '
const patchRowIdPattern = /^[a-z][a-z0-9-]*$/

export interface FeatureUpdate {
  readonly feature: PrivacyFeatureId
  readonly enabled: boolean
}

const featureOf = (id: string) => privacyFeatures.find(feature => feature.id === id)

const patchSequenceLength = (text: string): number | null => {
  if (text.trim() === '[]') return 0
  const document = parseDocument(text)
  if (document.errors.length > 0) return null
  if (document.contents === null) return 0
  return isSeq(document.contents) && !document.contents.flow ? document.contents.items.length : null
}

const rowIdFromLine = (line: string | undefined): string | null => {
  const match = /^- id: ([a-z][a-z0-9-]*)$/.exec(line?.replace(/\r$/, '') ?? '')
  return match?.[1] ?? null
}

const disabledFromLine = (line: string | undefined): boolean | null => {
  const match = /^  disabled: (true|false)$/.exec(line?.replace(/\r$/, '') ?? '')
  return match?.[1] === undefined ? null : match[1] === 'true'
}

const managedRowKey = (feature: PrivacyFeatureId, patchId: string): string => `${feature}:${patchId}`

export const readManagedOverrides = (text: string): ReadonlyMap<string, boolean> => {
  const lines = text.split(/\r?\n/)
  const overrides = new Map<string, boolean>()

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').replace(/\r$/, '')
    if (!line.startsWith(managedMarkerPrefix)) continue

    const featureId = line.slice(managedMarkerPrefix.length)
    const feature = featureOf(featureId)
    const patchId = rowIdFromLine(lines[index + 1])
    const disabled = disabledFromLine(lines[index + 2])
    if (feature === undefined || patchId === null || disabled === null || !feature.rows.some(row => row.patchId === patchId)) {
      throw new Error('The privacy-controls block in cordis.patch.yml was edited into an unsupported shape.')
    }
    overrides.set(managedRowKey(feature.id, patchId), disabled)
    index += 2
  }

  return overrides
}

export const withFeatureStates = (text: string, updates: readonly FeatureUpdate[]): string => {
  const normalizedText = text.trim() === '[]' ? '' : text
  const originalCount = patchSequenceLength(normalizedText)
  if (originalCount === null) throw new Error('Refusing to edit cordis.patch.yml because it is not a plain top-level YAML list.')

  const updateIds = new Set<PrivacyFeatureId>()
  for (const update of updates) {
    if (updateIds.has(update.feature)) throw new Error(`Duplicate privacy feature update: ${update.feature}.`)
    updateIds.add(update.feature)
  }

  const lineEnding = normalizedText.includes('\r\n') ? '\r\n' : '\n'
  const lines = normalizedText.split(/\r?\n/)
  const keptLines: string[] = []
  let removedRows = 0

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index] ?? ''
    const normalizedLine = currentLine.replace(/\r$/, '')
    if (!normalizedLine.startsWith(managedMarkerPrefix)) {
      keptLines.push(currentLine)
      continue
    }

    const featureId = normalizedLine.slice(managedMarkerPrefix.length)
    const feature = featureOf(featureId)
    if (feature === undefined) throw new Error(`Unknown privacy-controls marker: ${featureId}.`)
    if (!updateIds.has(feature.id)) {
      keptLines.push(currentLine)
      continue
    }

    const patchId = rowIdFromLine(lines[index + 1])
    const disabled = disabledFromLine(lines[index + 2])
    if (patchId === null || disabled === null || !feature.rows.some(row => row.patchId === patchId)) {
      throw new Error('The privacy-controls block in cordis.patch.yml was edited into an unsupported shape.')
    }
    removedRows += 1
    index += 2
  }

  const baseText = keptLines.join(lineEnding)
  const baseCount = patchSequenceLength(baseText)
  if (baseCount === null || baseCount !== originalCount - removedRows) {
    throw new Error('Refusing to rewrite a malformed privacy-controls profile patch.')
  }

  const blocks = updates.flatMap(update => {
    const feature = featureOf(update.feature)
    if (feature === undefined) throw new Error(`Unknown privacy feature: ${update.feature}.`)
    return feature.rows.map(row => {
      if (!patchRowIdPattern.test(row.patchId)) throw new Error(`Refusing unsafe profile row id: ${row.patchId}.`)
      return `${managedMarkerPrefix}${feature.id}${lineEnding}- id: ${row.patchId}${lineEnding}  disabled: ${String(!update.enabled)}`
    })
  })
  if (blocks.length === 0) return text

  const separator = baseText === '' || baseText.endsWith('\n') ? '' : lineEnding
  const nextText = `${baseText}${separator}${blocks.join(lineEnding)}${lineEnding}`
  const nextCount = patchSequenceLength(nextText)
  if (nextCount === null || nextCount !== baseCount + blocks.length) {
    throw new Error('Refusing to rewrite a malformed privacy-controls profile patch.')
  }
  return nextText
}
