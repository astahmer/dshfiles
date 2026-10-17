/**
 * Ported from @deepseek-ai/dsh-client-ui-settings-general@0.2.1-rc.2 (MIT): `HostReleasePrompt.js`. The native row
 * registers this dialog into `shell.overlay`, the frame-wide seat no shipped entry else fills, so the switched-off row
 * would otherwise leave a page reconnected to another Host release without its reload prompt.
 */
import type { ClientReleaseChange } from '@deepseek-ai/dsh-client-modules/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ShellTranslate } from './locales.js'

type Release = ClientReleaseChange['page']

/** Name both ends of one release transition: their versions when those differ, otherwise their commits. */
const transitionText = (from: Release, to: Release, unknown: string): readonly [string, string] => {
  const field = from?.version !== to?.version ? 'version' : 'commit'
  return [from?.[field] ?? unknown, to?.[field] ?? unknown]
}

/** One labelled transition line. A completed transition fades its start; a pending one fades its end. */
const Transition = (props: { readonly label: string; readonly from: string; readonly to: string; readonly done: boolean }): JSX.Element => (
  <>
    <span className="dshx:text-(--dsw-alias-label-secondary)">{props.label}</span>
    <span className={cn('dshx:font-mono dshx:break-words', props.done ? 'dshx:text-(--dsw-alias-label-tertiary)' : 'dshx:text-(--dsw-alias-label-primary)')}>
      {props.from}
    </span>
    <span
      aria-hidden="true"
      className={cn(
        "dshx:relative dshx:h-0 dshx:border-t dshx:after:absolute dshx:after:-top-[3.5px] dshx:after:-right-px dshx:after:border-y-[3px] dshx:after:border-y-transparent dshx:after:border-l-[5px] dshx:after:border-l-current dshx:after:content-['']",
        props.done
          ? 'dshx:border-solid dshx:border-t-[var(--dsw-alias-state-success-primary)] dshx:text-(--dsw-alias-state-success-primary)'
          : 'dshx:border-dashed dshx:border-t-[var(--dsw-alias-label-tertiary)] dshx:text-(--dsw-alias-label-tertiary)',
      )}
    />
    <span className={cn('dshx:font-mono dshx:break-words', props.done ? 'dshx:text-(--dsw-alias-label-primary)' : 'dshx:text-(--dsw-alias-label-tertiary)')}>
      {props.to}
    </span>
  </>
)

/**
 * Ask whether to reload after the Host changed releases; closing the dialog keeps the page. The service line shows the
 * Host's completed switch from its previous release; the page line shows the switch from the page's boot release that
 * only a reload completes.
 */
export const HostReleasePrompt = (props: {
  readonly useReleaseChange: SnapshotSelectorHook<ClientReleaseChange | undefined>
  readonly dismissRelease: () => void
  readonly reloadPage: () => void
  readonly t: ShellTranslate
}): JSX.Element | null => {
  const change = props.useReleaseChange(value => value)
  if (change === undefined) return null
  const unknown = props.t('hostRelease.unknown')
  const [serviceFrom, serviceTo] = transitionText(change.previous, change.host, unknown)
  const [pageFrom, pageTo] = transitionText(change.page, change.host, unknown)
  return (
    <Modal
      className="dshx:w-[min(480px,100%)]"
      closeLabel={props.t('hostRelease.later')}
      description={props.t('hostRelease.description')}
      footer={
        <>
          <Button data-modal-autofocus onClick={props.dismissRelease} variant="outline">
            {props.t('hostRelease.later')}
          </Button>
          <Button onClick={props.reloadPage} variant="primary">
            {props.t('hostRelease.reload')}
          </Button>
        </>
      }
      onClose={props.dismissRelease}
      open
      title={props.t('hostRelease.title')}
    >
      <div className="dshx:grid dshx:grid-cols-[max-content_minmax(0,max-content)_56px_minmax(0,max-content)] dshx:items-center dshx:justify-start dshx:gap-x-3 dshx:gap-y-2 dshx:text-[13px] dshx:leading-5">
        <Transition done from={serviceFrom} label={props.t('hostRelease.service')} to={serviceTo} />
        <Transition done={false} from={pageFrom} label={props.t('hostRelease.page')} to={pageTo} />
      </div>
    </Modal>
  )
}
