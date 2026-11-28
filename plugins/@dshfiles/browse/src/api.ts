import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'
import { browseStatusSchema, pairingSchema, pairingsSchema, type BrowseStatus, type Pairing, type Pairings } from './model.js'

const emptyInputSchema = Schema.Struct({})

const pairingTargetSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200), Schema.isPattern(/^[^-\s][^\n\r]*$/u)).annotate({
  description: 'The paired browser to remove: its profile (the stable key from browse_pairings), id or name.',
})

const renderPairing = (pairing: Pairing): string => {
  if (pairing.state === 'pending')
    return `Pairing code ${pairing.code ?? '?'}: enter it in the browse extension (Extensions → browse → Options → Pairing code). It works once.`
  if (pairing.state === 'paired') return `Paired ${pairing.browser ?? 'a browser'}.`
  if (pairing.state === 'idle') return 'No pairing running.'
  return `Pairing ${pairing.state}${pairing.message === null ? '' : `: ${pairing.message}`}`
}

const renderStatus = (status: BrowseStatus): string => {
  if (status.kind === 'not-installed') return `browse is not installed (${status.command}). ${status.recovery}`
  if (status.kind === 'failed') return `browse status failed: ${status.message} ${status.recovery}`
  const lines = [
    `browse ${status.version ?? '?'}; relay ${status.relay.running ? `running at ${status.relay.endpoint ?? '?'}` : 'not running (it starts when an agent uses browse)'}.`,
    status.relay.running ? `Extension: ${status.extension.connected ? 'connected' : (status.extension.pairingState ?? 'unknown')}.` : '',
    status.extension.nextStep ?? '',
    ...status.browsers.map(
      browser => `Browser: ${browser.name} (${browser.id})${browser.connected ? '' : ', offline'}${browser.isDefault ? ', default' : ''}.`,
    ),
    `Agent tabs: ${status.tabs.length}; waiting on the user: ${status.waiting}.`,
    ...status.tabs.flatMap(tab =>
      tab.handoff === null ? [] : [`Tab ${tab.tab} (${tab.url}) waits since ${tab.handoff.startedAt ?? '?'}: ${tab.handoff.message}`],
    ),
    status.pairing.state === 'idle' ? '' : renderPairing(status.pairing),
  ]
  return lines.filter(line => line.length > 0).join('\n')
}

const renderPairings = (pairings: Pairings): string =>
  pairings.browsers.length === 0
    ? 'No paired browsers.'
    : pairings.browsers
        .map(
          browser =>
            `${browser.name ?? browser.id ?? '(not connected yet)'} — profile ${browser.profile}, paired ${browser.paired}, last seen ${browser.lastSeen}`,
        )
        .join('\n')

export const browseApi = defineApi({
  id: 'browse',
  version: 1,
  owner: '@dshfiles/browse',
  methods: {
    status: method({
      input: emptyInputSchema,
      output: browseStatusSchema,
      readOnly: true,
      description:
        'Report the local browse setup: CLI version, whether its relay runs, the extension and connected browsers, agent tabs, tabs waiting on the user (handoff message and since when) and the pairing in progress. Never starts the relay. Read-only.',
      tool: { name: 'browse_status', readOnly: true, render: renderStatus },
    }),
    pairingStart: method({
      input: emptyInputSchema,
      output: pairingSchema,
      description:
        'Start pairing a browser with browse: returns a one-time code the user enters in the browse extension (Extensions → browse → Options → Pairing code), valid 10 minutes. Starts the relay if needed. A pairing already running returns its code. Run only when the user asked to pair a browser.',
      tool: { name: 'browse_pair_start', readOnly: false, render: renderPairing },
    }),
    pairingCancel: method({
      input: emptyInputSchema,
      output: pairingSchema,
      description: 'Stop the pairing in progress; its code stops being awaited. Run only when the user asked to cancel pairing.',
      tool: { name: 'browse_pair_cancel', readOnly: false, render: renderPairing },
    }),
    pairings: method({
      input: emptyInputSchema,
      output: pairingsSchema,
      readOnly: true,
      description: 'List the browsers paired with browse: id, name, profile key, when paired and when last seen. Read-only.',
      tool: { name: 'browse_pairings', readOnly: true, render: renderPairings },
    }),
    pairingRevoke: method({
      input: Schema.Struct({
        target: pairingTargetSchema,
        confirm: Schema.Literal(true).annotate({ description: 'Must be true: unpairing disconnects that browser until it is paired again.' }),
      }),
      output: Schema.Struct({ revoked: Schema.Boolean, message: Schema.String.check(Schema.isMaxLength(500)) }),
      description:
        'Unpair one browser from browse (destructive: it disconnects until paired again with browse_pair_start). Run only when the user asked to unpair that browser; pass confirm: true, which is required.',
      tool: { name: 'browse_pairing_revoke', readOnly: false, render: outcome => outcome.message },
    }),
  },
})
