import { useApi } from '@dshfiles/dshx/client'
import type { SecretScope } from '@dshfiles/credential-port'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { useEffect, useState } from 'react'
import { secretSetupApi } from './api.js'
import { SECRET_CATALOG_LOCALE_NAMESPACE } from './locales.js'
import type { SecretCatalogTranslate } from './locales.js'
import { SecretSetupForm, type SecretSetupTarget } from './secret-setup-form.js'
import { SecretSetupSteps, type SecretSetupStep } from './secret-setup-step.js'

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

const addId = (current: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set([...current, id])
const removeId = (current: ReadonlySet<string>, id: string): ReadonlySet<string> => new Set([...current].filter(currentId => currentId !== id))

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
  const [opened, setOpened] = useState(false)
  const [editingIds, setEditingIds] = useState<ReadonlySet<string>>(new Set())
  const [steps, setSteps] = useState<Readonly<Record<string, SecretSetupStep>>>({})
  useEffect(() => {
    const active = new Set(props.missing.map(requirement => requirement.id))
    setEditingIds(current => new Set([...current].filter(id => active.has(id))))
    setSteps(current => Object.fromEntries(Object.entries(current).filter(([id]) => active.has(id))))
  }, [props.missing])
  const busyIds = new Set(
    Object.entries(steps)
      .filter(([, step]) => SecretSetupSteps.busy(step))
      .map(([id]) => id),
  )
  const boundIds = new Set(
    Object.entries(steps)
      .filter(([, step]) => step.kind === 'bound')
      .map(([id]) => id),
  )
  const createdReferences = Object.fromEntries(
    Object.entries(steps).flatMap(([id, step]) => {
      const reference = SecretSetupSteps.createdReference(step)
      return reference === undefined ? [] : [[id, reference]]
    }),
  )

  if (props.missing.length === 0 || catalog.isError || catalog.data === undefined) return null

  const openSetup = (): void => {
    setOpened(true)
    setEditingIds(new Set(props.missing.map(requirement => requirement.id).filter(id => !boundIds.has(id))))
  }
  const closeSetup = (): void => {
    if (busyIds.size > 0) return
    setOpened(false)
    setEditingIds(new Set())
  }
  const visibleRequirements = props.missing.filter(requirement => !opened || boundIds.has(requirement.id) || !editingIds.has(requirement.id))

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
        {opened ? (
          <Button disabled={busyIds.size > 0} onClick={closeSetup} size="sm" type="button" variant="ghost">
            {props.t('setupCancel')}
          </Button>
        ) : (
          <Button onClick={openSetup} size="sm" type="button">
            {props.t('setupOpen')}
          </Button>
        )}
      </div>
      {visibleRequirements.length > 0 ? (
        <ul className="dshx:flex dshx:flex-col dshx:gap-1">
          {visibleRequirements.map(requirement => (
            <li className="dshx:flex dshx:flex-wrap dshx:items-center dshx:justify-between dshx:gap-2" key={requirement.id}>
              <span className="dshx:min-w-0 dshx:truncate dshx:text-sm">{requirement.label}</span>
              {boundIds.has(requirement.id) ? <span className="dshx:text-xs dshx:text-success">{props.t('setupBound')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {opened ? (
        <div className="dshx:flex dshx:flex-col dshx:gap-3">
          {props.missing.map(requirement => {
            if (boundIds.has(requirement.id)) return null
            if (!editingIds.has(requirement.id)) {
              return (
                <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2" key={requirement.id}>
                  <span className="dshx:min-w-0 dshx:truncate dshx:text-sm">{requirement.label}</span>
                  <Button onClick={() => setEditingIds(current => addId(current, requirement.id))} size="sm" type="button" variant="outline">
                    {createdReferences[requirement.id] === undefined ? props.t('setupResume') : props.t('setupRetryBind')}
                  </Button>
                </div>
              )
            }
            return (
              <div className="dshx:flex dshx:flex-col dshx:gap-2" key={requirement.id}>
                <h4 className="dshx:text-sm dshx:font-medium">{requirement.label}</h4>
                <SecretSetupForm
                  onBind={reference => props.onBind({ id: requirement.id, reference })}
                  onBound={reference => {
                    setSteps(current => ({ ...current, [requirement.id]: { kind: 'bound', reference } }))
                    setEditingIds(current => removeId(current, requirement.id))
                  }}
                  onCancel={() => setEditingIds(current => removeId(current, requirement.id))}
                  onStepChange={step => setSteps(current => ({ ...current, [requirement.id]: step }))}
                  step={steps[requirement.id] ?? SecretSetupSteps.restore(createdReferences[requirement.id])}
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
