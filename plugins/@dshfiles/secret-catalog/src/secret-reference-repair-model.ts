import type { SecretReferenceStatus } from './secret-reference-status-schema.js'

export type RepairMessageKey =
  | 'refStateResolved'
  | 'refStateInvalid'
  | 'refStateAliasMissing'
  | 'refStateAliasOnlyElsewhere'
  | 'refStateEnvironmentMissing'
  | 'refStateAmbiguous'
  | 'refStateValueUnreadable'
  | 'refStateValueEmpty'
  | 'refStateCliMissing'
  | 'refStateCliTimeout'
  | 'refStateCliFailed'

export interface RepairView {
  readonly messageKey: RepairMessageKey
  readonly params: Readonly<Record<string, string>>
  /** `create` stores the alias in `writeScope`; `replace` overwrites the matched alias' value; null offers neither. */
  readonly setValue: 'create' | 'replace' | null
  /** The global write lands in a symlinked config, which the card names before saving. */
  readonly symlinkTarget: string | null
}

const messageKeys = {
  resolved: 'refStateResolved',
  'invalid-reference': 'refStateInvalid',
  'environment-missing': 'refStateEnvironmentMissing',
  ambiguous: 'refStateAmbiguous',
  'value-unreadable': 'refStateValueUnreadable',
  'value-empty': 'refStateValueEmpty',
  'cli-missing': 'refStateCliMissing',
  'cli-timeout': 'refStateCliTimeout',
  'cli-failed': 'refStateCliFailed',
} as const satisfies Record<Exclude<SecretReferenceStatus['state'], 'empty' | 'alias-missing'>, RepairMessageKey>

const setValueModes = {
  resolved: null,
  empty: null,
  'invalid-reference': null,
  'alias-missing': 'create',
  'environment-missing': 'create',
  ambiguous: null,
  'value-unreadable': 'replace',
  'value-empty': 'replace',
  'cli-missing': null,
  'cli-timeout': null,
  'cli-failed': null,
} as const satisfies Record<SecretReferenceStatus['state'], RepairView['setValue']>

/** What a reference repair card says and offers for one Host status; null when there is nothing to repair. */
export const repairView = (status: SecretReferenceStatus): RepairView | null => {
  if (status.state === 'empty') return null
  const firstElsewhere = status.elsewhere[0]
  const messageKey =
    status.state === 'alias-missing' ? (firstElsewhere === undefined ? 'refStateAliasMissing' : 'refStateAliasOnlyElsewhere') : messageKeys[status.state]
  const setValue = setValueModes[status.state]
  const writesGlobal = setValue === 'create' ? status.writeScope === 'global' : status.scope === 'global'
  return {
    messageKey,
    params: {
      reference: status.reference ?? '',
      alias: status.alias ?? '',
      environment: status.environment ?? '',
      environments: status.environments.join(', '),
      scopes: status.scopes.join(', '),
      scope: status.scope ?? status.writeScope,
      writeScope: status.writeScope,
      folder: firstElsewhere?.folder ?? '',
      elsewhereScope: firstElsewhere?.scope ?? '',
    },
    setValue,
    symlinkTarget: setValue !== null && writesGlobal ? status.globalConfig.linkedTo : null,
  }
}
