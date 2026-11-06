/**
 * Channel and event-key naming for the dshx API protocol.
 *
 * These are pure string helpers with no imports on purpose: the browser tracing transport, which ships in every Client
 * bundle, needs the channel name and must not drag schema validation or any other runtime library in with it.
 */

const stableHash = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export class ApiChannelModel {
  static apiChannel(packageId: string, apiId: string): string {
    return `/dshx-${stableHash(`${packageId}\0${apiId}`)}`
  }

  /** The one browser event stream of a DSH process, below Connection's authenticated `/api` channel. */
  static readonly eventsPath = '/api/dshx-events'

  /** The one batched-read route of a DSH process: many read calls in one POST, one NDJSON answer line per call. */
  static readonly batchPath = '/api/dshx-batch'

  /** `<channel>/<event>`: the key a browser subscribes to, unique per owner, API and event. */
  static eventKey(owner: string, apiId: string, event: string): string {
    return `${ApiChannelModel.apiChannel(owner, apiId).slice(1)}/${event}`
  }
}
