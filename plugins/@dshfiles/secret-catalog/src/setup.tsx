import { useApi } from '@dshfiles/dshx/client'
import type { SecretScope } from '@dshfiles/credential-port'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { secretSetupApi } from './api.js'
import { SECRET_CATALOG_LOCALE_NAMESPACE } from './locales.js'
import type { SecretCatalogTranslate } from './locales.js'
import { SecretSetupForm, type SecretSetupTarget } from './secret-setup-form.js'
import { SecretSetupOffer as SecretSetupOfferModel } from './secret-setup-offer.js'
import { SecretSetupSteps } from './secret-setup-step.js'

export { SECRET_CATALOG_LOCALE_NAMESPACE }
export type { SecretCatalogTranslate } from './locales.js'

export interface SecretSetupRequirement {
  readonly id: string
  readonly label: string
  readonly suggestedAlias?: string
  readonly environment?: string
  readonly scope?: SecretScope
  readonly cwd?: string | null
}

export interface SecretSetupBinding {
  readonly id: string
  readonly reference: string
}

export interface SecretSetupOfferProps {
  readonly missing: readonly SecretSetupRequirement[]
  readonly t: SecretCatalogTranslate
  readonly onBind: (binding: SecretSetupBinding) => Promise<void>
}

const targetOf = (requirement: SecretSetupRequirement): SecretSetupTarget => {
  const target: SecretSetupTarget = {
    cwd: requirement.cwd ?? null,
  }
  if (requirement.suggestedAlias !== undefined) target.suggestedAlias = requirement.suggestedAlias
  if (requirement.environment !== undefined) target.environment = requirement.environment
  if (requirement.scope !== undefined) target.scope = requirement.scope
  return target
}

export const SecretSetupOffer = (props: SecretSetupOfferProps): JSX.Element | null => {
  const api = useApi(secretSetupApi)
  const cwd = props.missing[0]?.cwd ?? null
  const catalog = useQuery({
    queryKey: ['secret-catalog', 'list', cwd],
    enabled: props.missing.length > 0,
    queryFn: ({ signal }) => api.list({ cwd }, { signal }),
    retry: false,
    staleTime: 30_000,
  })
  const [offer, setOffer] = useState(SecretSetupOfferModel.initial)
  useEffect(() => {
    setOffer(current => SecretSetupOfferModel.prune({ state: current, ids: props.missing.map(requirement => requirement.id) }))
  }, [props.missing])

  if (props.missing.length === 0 || catalog.isError || catalog.data === undefined) return null

  const ids = props.missing.map(requirement => requirement.id)
  const busy = SecretSetupOfferModel.busy(offer)
  const visibleRequirements = props.missing.filter(
    requirement => offer.panel === 'closed' || SecretSetupOfferModel.bound(offer, requirement.id) || offer.requirements[requirement.id] === undefined,
  )

  return (
    <section
      className="dshx-root dshx:@container dshx:flex dshx:max-w-xl dshx:flex-col dshx:gap-2 dshx:rounded-md dshx:border dshx:border-border dshx:bg-card dshx:p-3"
      data-testid="secret-setup-offer"
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-start dshx:justify-between dshx:gap-2">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
          <h3 className="dshx:text-sm dshx:font-semibold">{props.t('setupRequiredTitle')}</h3>
          <p className="dshx:text-xs dshx:text-muted-foreground">{props.t('setupRequiredDescription')}</p>
        </div>
        {offer.panel === 'open' ? (
          <Button disabled={busy} onClick={() => setOffer(current => SecretSetupOfferModel.close(current))} size="sm" type="button" variant="ghost">
            {props.t('setupCancel')}
          </Button>
        ) : (
          <Button onClick={() => setOffer(current => SecretSetupOfferModel.open({ state: current, ids }))} size="sm" type="button">
            {props.t('setupOpen')}
          </Button>
        )}
      </div>
      {visibleRequirements.length > 0 ? (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {visibleRequirements.map(requirement => (
            <li className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2" key={requirement.id}>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-sm">{requirement.label}</span>
              {SecretSetupOfferModel.bound(offer, requirement.id) ? <span className="dshx:text-xs dshx:text-success">{props.t('setupBound')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {offer.panel === 'open' ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-3">
          {props.missing.map(requirement => {
            if (SecretSetupOfferModel.bound(offer, requirement.id)) return null
            if (!SecretSetupOfferModel.editing(offer, requirement.id)) {
              return (
                <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2" key={requirement.id}>
                  <span className="dshx:min-w-0 dshx:truncate dshx:text-sm">{requirement.label}</span>
                  <Button
                    onClick={() => setOffer(current => SecretSetupOfferModel.edit({ state: current, id: requirement.id }))}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {SecretSetupOfferModel.createdReference(offer, requirement.id) === undefined ? props.t('setupResume') : props.t('setupRetryBind')}
                  </Button>
                </div>
              )
            }
            const requirementState = offer.requirements[requirement.id]
            const step = requirementState?.kind === 'editing' ? requirementState.step : SecretSetupSteps.draft()
            return (
              <div className="dshx:flex dshx:flex-col dshx:gap-2" key={requirement.id}>
                <h4 className="dshx:text-sm dshx:font-medium">{requirement.label}</h4>
                <SecretSetupForm
                  onBind={reference => props.onBind({ id: requirement.id, reference })}
                  onBound={reference => {
                    setOffer(current => SecretSetupOfferModel.markBound({ state: current, id: requirement.id, reference }))
                  }}
                  onCancel={() => setOffer(current => SecretSetupOfferModel.cancel({ state: current, id: requirement.id }))}
                  onStepChange={next => setOffer(current => SecretSetupOfferModel.step({ state: current, id: requirement.id, step: next }))}
                  step={step}
                  t={props.t}
                  target={targetOf(requirement)}
                />
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
