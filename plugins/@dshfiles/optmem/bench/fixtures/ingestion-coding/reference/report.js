import { validateScope } from './errors.js'

export const summarize = ({ snapshot, organization, provider }) => {
  validateScope({ organization, provider })
  const current = snapshot.scopes.find(item => item.organization === organization && item.provider === provider)
  return {
    organization,
    provider,
    nextPage: current?.nextPage ?? 0,
    recordCount: current?.records.length ?? 0,
    complete: current?.complete ?? false,
    acquiredPages: current?.commits.length ?? 0,
  }
}
