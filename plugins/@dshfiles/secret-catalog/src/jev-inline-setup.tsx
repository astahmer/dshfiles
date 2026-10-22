import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useApi, useSettings } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { KeyRoundIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { backlogApi } from '@dshfiles/backlog/api'
import { backlogSettings } from '@dshfiles/backlog/settings'
import { useLayoutEffect, useSyncExternalStore, useState } from 'react'
import { secretCatalogApi } from './api.js'
import { JevSecretSetup } from './jev-secret-setup.js'
import { JevChatTurnTimeline } from './jev-chat-turn-timeline.js'
import { JEV_SECRET_ALIAS, JEV_SECRET_ENVIRONMENT, saveGlobalJevSecret } from './jev-secret-store.js'
import { type SecretCatalogTranslate } from './locales.js'

const statusQueryKey = ['secret-catalog', 'backlog-jev-setup-status'] as const
const idlePendingChange = (): void => {}

const chatTurnTimeline = new JevChatTurnTimeline()

export const JevInlineSetup = (props: { readonly sessionId: string; readonly turn: TurnLocation; readonly t: SecretCatalogTranslate }): JSX.Element | null => {
  const backlog = useApi(backlogApi)
  const secrets = useApi(secretCatalogApi)
  const settings = useSettings(backlogSettings)
  const queryClient = useQueryClient()
  const [setupOpen, setSetupOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  useLayoutEffect(() => {
    chatTurnTimeline.publish(props.sessionId, props.turn.turn)
  }, [props.sessionId, props.turn.turn])

  const isLatestTurn = useSyncExternalStore(
    chatTurnTimeline.subscribe,
    () => chatTurnTimeline.isLatest(props.sessionId, props.turn.turn),
    () => false,
  )
  const status = useQuery({
    queryKey: statusQueryKey,
    enabled: settings.status === 'ready' && settings.value?.jevEnabled === true,
    queryFn: ({ signal }) => backlog.jevSetupStatus(undefined, { signal }),
    retry: false,
    staleTime: 10_000,
  })
  const aliases = useQuery({
    queryKey: ['secret-catalog', 'list', null],
    enabled: setupOpen,
    queryFn: ({ signal }) => secrets.list({ cwd: null }, { signal }),
    staleTime: 30_000,
  })
  const matchingAliases = (aliases.data ?? []).filter(
    row => row.alias === JEV_SECRET_ALIAS && row.scope === 'global' && row.environment === JEV_SECRET_ENVIRONMENT,
  )
  let unavailable: 'loading' | 'failed' | 'ambiguous' | null = null
  if (aliases.isError) unavailable = 'failed'
  else if (aliases.data === undefined) unavailable = 'loading'
  else if (matchingAliases.length > 1) unavailable = 'ambiguous'

  const saveKey = async (value: string): Promise<void> => {
    if (!settings.writable || settings.status !== 'ready' || aliases.data === undefined || matchingAliases.length > 1)
      throw new Error('The Jev key setup is not ready.')
    const reference = await saveGlobalJevSecret({ api: secrets, existing: matchingAliases.length === 1, value })
    if (!(await settings.set('jevSecret', reference))) throw new Error('Backlog refused the secret reference.')
    setSaved(true)
    await Promise.all([queryClient.invalidateQueries({ queryKey: statusQueryKey }), queryClient.invalidateQueries({ queryKey: ['secret-catalog', 'list'] })])
  }

  const turnFinished = props.turn.end !== undefined
  if (!turnFinished || !isLatestTurn) return null
  if (saved) {
    return (
      <div className="dshx-root dshx:mt-3 dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm dshx:text-muted-foreground" role="status">
        <KeyRoundIcon aria-hidden="true" className="dshx:size-4" />
        {props.t('jevChatSetupSaved')}
      </div>
    )
  }
  if (status.data?.needsSetup !== true || settings.status !== 'ready' || settings.value?.jevEnabled !== true || !settings.writable) return null

  return (
    <section
      className="dshx-root dshx:my-3 dshx:flex dshx:w-full dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:bg-muted/40 dshx:p-3"
      data-testid="jev-inline-setup-offer"
    >
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2">
        <KeyRoundIcon aria-hidden="true" className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" />
        <p className="dshx:min-w-0 dshx:flex-1 dshx:text-sm dshx:text-muted-foreground">{props.t('jevChatSetupHint')}</p>
        {!setupOpen ? (
          <Button
            aria-label={props.t('jevChatSetupButton')}
            data-testid="jev-inline-setup-button"
            onClick={() => setSetupOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <KeyRoundIcon aria-hidden="true" className="dshx:size-3.5" />
            {props.t('jevChatSetupButton')}
          </Button>
        ) : null}
      </div>
      {setupOpen ? (
        <div className="dshx:max-w-xl dshx:rounded-md dshx:border dshx:border-border dshx:bg-background dshx:p-2">
          <JevSecretSetup
            existing={matchingAliases.length === 1}
            onCancel={() => setSetupOpen(false)}
            onPendingChange={idlePendingChange}
            onSave={saveKey}
            onSaved={() => setSaved(true)}
            t={props.t}
            unavailable={unavailable}
          />
        </div>
      ) : null}
    </section>
  )
}
