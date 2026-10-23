import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { KeyRoundIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { backlogApi } from '@dshfiles/backlog/api'
import { backlogSettings } from '@dshfiles/backlog/settings'
import { useLayoutEffect, useSyncExternalStore, useState } from 'react'
import { JevChatTurnTimeline } from './jev-chat-turn-timeline.js'
import { jevSetupView } from './jev-inline-setup-model.js'
import { type SecretCatalogTranslate } from './locales.js'
import { SecretReferenceRepair } from './secret-reference-repair.js'
import { SecretSetupOffer } from './setup.js'
import type { SecretSetupRequirement } from './setup.js'

const statusQueryKey = ['secret-catalog', 'backlog-jev-setup-status'] as const
const jevSetupRequirements: readonly SecretSetupRequirement[] = [
  { id: 'jevSecret', label: 'TypeSafe API key', suggestedAlias: 'TYPESAFE_API_KEY', environment: 'prod', scope: 'global' },
]
const chatTurnTimeline = new JevChatTurnTimeline()

export const JevInlineSetup = (props: {
  readonly sessionId: string
  readonly turn: TurnLocation
  readonly probeFolders: readonly string[]
  readonly t: SecretCatalogTranslate
}): JSX.Element | null => {
  const backlog = useApi(backlogApi)
  const settings = useSettings(backlogSettings)
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(false)
  const jevEnabled = settings.status === 'ready' && settings.value?.jevEnabled === true
  const secretReference = settings.status === 'ready' ? (settings.value?.jevSecret.trim() ?? '') : ''

  useLayoutEffect(() => {
    chatTurnTimeline.publish(props.sessionId, props.turn.turn)
  }, [props.sessionId, props.turn.turn])

  const isLatestTurn = useSyncExternalStore(
    chatTurnTimeline.subscribe,
    () => chatTurnTimeline.isLatest(props.sessionId, props.turn.turn),
    () => false,
  )
  const turnFinished = props.turn.end !== undefined
  // Backlog's own answer only matters while no reference is configured (the environment fallback): a configured
  // reference is checked by its exact text below, so a settings save can never race a stale Host answer.
  const status = useQuery({
    queryKey: statusQueryKey,
    enabled: jevEnabled && secretReference === '' && turnFinished && isLatestTurn,
    queryFn: ({ signal }) => backlog.jevSetupStatus(undefined, { signal }),
    retry: false,
    staleTime: 10_000,
  })

  if (!turnFinished || !isLatestTurn) return null
  if (saved) {
    return (
      <div className="dshx-root dshx:mt-3 dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
        <KeyRoundIcon aria-hidden="true" className="dshx:size-4" />
        {props.t('jevChatSetupSaved')}
      </div>
    )
  }
  const setupView = jevSetupView({ enabled: jevEnabled, needsSetup: status.data?.needsSetup === true, reference: secretReference })
  if (setupView === 'hidden' || !settings.writable) return null
  const bindReference = async (reference: string): Promise<void> => {
    if (!settings.writable || settings.status !== 'ready') throw new Error('Backlog cannot accept a secret reference right now.')
    if (!(await settings.set('jevSecret', reference))) throw new Error('Backlog refused the secret reference.')
  }
  if (setupView === 'repair') {
    return (
      <SecretReferenceRepair
        className="dshx:mt-3"
        cwd={null}
        onBind={bindReference}
        probeFolders={props.probeFolders}
        reference={secretReference}
        t={props.t}
      />
    )
  }

  return (
    <div className="dshx-root" data-testid="jev-inline-setup-offer">
      <SecretSetupOffer
        missing={jevSetupRequirements}
        onBind={async binding => {
          if (binding.id !== 'jevSecret') throw new Error('The setup suggestion does not match the Backlog setting.')
          await bindReference(binding.reference)
          setSaved(true)
          void queryClient.invalidateQueries({ queryKey: statusQueryKey }).catch(() => undefined)
        }}
        t={props.t}
      />
    </div>
  )
}
