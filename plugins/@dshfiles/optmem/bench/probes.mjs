// Probe scoring shared by the live driver and the report (which re-scores stored answers against the scenario file).

/** Replace `{{truth.key}}` placeholders with fixture ground truth. */
export const fillTruth = (text, truth) =>
  text.replace(/\{\{truth\.([\w.]+)\}\}/g, (_, key) => String(key.split('.').reduce((value, part) => value?.[part], truth)))

/** Case-insensitive substring match; each expectation is a string or a list of accepted alternatives. */
export const scoreProbe = ({ answer, probe, truth, tools = [] }) => {
  const normalized = answer.toLowerCase().replace(/[`*]/g, '')
  const matches = item => [item].flat().some(option => normalized.includes(fillTruth(option, truth).toLowerCase()))
  const missing = probe.expect.filter(item => !matches(item)).map(item => [item].flat().join('/'))
  const forbidden = (probe.forbid ?? []).filter(matches)
  const memoryOnly = ['delayed-recall', 'cross-session', 'negative-recall'].includes(probe.kind)
  const forbiddenTools = memoryOnly ? tools.filter(name => !/(?:^|\.)memory_(?:search|zoom|context|status|read)$/.test(name)) : []
  const exactNegative = probe.kind !== 'negative-recall' || normalized.trim() === 'not_recorded'
  return {
    id: probe.id,
    kind: probe.kind ?? 'recall',
    pass: missing.length === 0 && forbidden.length === 0 && forbiddenTools.length === 0 && exactNegative,
    missing,
    forbidden,
    forbiddenTools,
    exactNegative,
  }
}
