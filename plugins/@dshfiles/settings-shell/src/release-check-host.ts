import { withSpan } from '@dshfiles/dshx/tracing'
import { fetchDshReleaseStatus, type DshReleaseStatus } from './release-status.js'

/** Host-only: one `dsh release check` span around the GitHub Releases request; whether a newer release exists, never the payload. */
export const checkDshRelease = (input: Parameters<typeof fetchDshReleaseStatus>[0]): Promise<DshReleaseStatus> =>
  withSpan('dsh release check', { kind: 'client', attributes: { 'server.address': 'api.github.com' } }, async span => {
    const status = await fetchDshReleaseStatus(input)
    span.setAttributes({ 'dshx.settings-shell.available': status.available, 'dshx.settings-shell.releases': status.releases.length })
    return status
  })
