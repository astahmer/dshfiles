import type { PageAction } from '@dshfiles/plugin-ui/components/page'
import { RefreshCwIcon } from '@dshfiles/plugin-ui/icons'

/**
 * The page's one maintenance verb. A healthy index needs no button in the header, so it waits in the page ⋯; when
 * indexing or a re-index failed, it returns as a header button beside the error (council round 8, D1).
 */
export const reindexAction = (props: { readonly healthy: boolean; readonly pending: boolean; readonly onSelect: () => void }): PageAction => ({
  id: 'reindex',
  label: 'Re-index thread logs',
  icon: <RefreshCwIcon aria-hidden />,
  pending: props.pending,
  placement: props.healthy ? 'overflow' : 'inline',
  onSelect: props.onSelect,
})
