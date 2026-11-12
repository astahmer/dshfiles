import type { SetupCheck } from './api.js'

const NODE_IDS = ['node-version', 'node-origin', 'fnm']
const ORDER = { fail: 0, warn: 1, ok: 2 } satisfies Record<SetupCheck['state'], number>

/**
 * The rows Check shows: what needs attention first, and a healthy Node, its build and fnm read as one row
 * ("24.11.1 from fnm") instead of three.
 */
const rowsOf = (checks: readonly SetupCheck[]): readonly SetupCheck[] => {
  const node = NODE_IDS.map(id => checks.find(check => check.id === id))
  const [version, origin, fnm] = node
  const merged =
    version?.state === 'ok' && origin?.state === 'ok' && fnm?.state === 'ok'
      ? checks.flatMap(check => {
          if (check.id === 'node-version')
            return [
              {
                id: 'node',
                label: check.label,
                state: check.state,
                detail: `${version.detail.replace(/^v/u, '')}${origin.detail === 'From fnm' ? ' from fnm' : `, ${origin.detail.toLowerCase()}`}`,
                path: null,
                fix: null,
              },
            ]
          return NODE_IDS.includes(check.id) ? [] : [check]
        })
      : checks
  return [...merged].sort((left, right) => ORDER[left.state] - ORDER[right.state])
}

/** The one sentence Check leads with. */
const summaryOf = (checks: readonly SetupCheck[]): string => {
  const failing = checks.filter(check => check.state === 'fail').length
  const optional = checks.filter(check => check.state === 'warn').length
  if (failing > 0) return failing === 1 ? 'One thing to fix before setup can continue.' : `${String(failing)} things to fix before setup can continue.`
  if (optional > 0)
    return optional === 1 ? 'Ready to set up. One optional tool is missing.' : `Ready to set up. ${String(optional)} optional tools are missing.`
  return 'Everything setup needs is here.'
}

export class CheckModel {
  static readonly rows = rowsOf
  static readonly summary = summaryOf
}
