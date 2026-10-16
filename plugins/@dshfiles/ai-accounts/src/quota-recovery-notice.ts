/**
 * Whether the inline quota-recovery notice renders for the turn that just failed.
 *
 * The preference is the master switch. With exhausted-limit failover off, the
 * notice stands on its own: it explains the stop and offers the manual resume.
 * With failover on it appears only when the ladder still stored a recovery for
 * this turn, because that is the only case where its controls can act — DSH had
 * no other account to take the request.
 */
export const showsQuotaRecoveryNotice = (input: { readonly showChoice: boolean; readonly failoverEnabled: boolean; readonly hasRecovery: boolean }): boolean =>
  input.showChoice && (!input.failoverEnabled || input.hasRecovery)
