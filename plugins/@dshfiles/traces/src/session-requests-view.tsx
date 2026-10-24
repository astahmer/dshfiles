import { RequestLog } from '@dshfiles/usage/request-log'
import { useState } from 'react'

const HISTORY_RANGE = { from: 0, to: Number.MAX_SAFE_INTEGER }

export const SessionRequestsView = (props: {
  readonly sessionId: string
  readonly openThread: (target: { readonly sessionId: string; readonly parentSessionId: string | null }) => 'opened' | 'parent' | 'missing'
}): JSX.Element => {
  const [search, setSearch] = useState('')

  return (
    <main className="dshx-root dshx:h-full dshx:min-h-0 dshx:overflow-auto dshx:p-4" data-testid="requests-session-view" data-session-id={props.sessionId}>
      <RequestLog range={HISTORY_RANGE} purposes={undefined} sessionId={props.sessionId} search={search} onSearch={setSearch} openThread={props.openThread} />
    </main>
  )
}
