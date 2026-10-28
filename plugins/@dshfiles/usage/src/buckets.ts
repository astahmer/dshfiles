export type ChartBucket = 'hour' | 'day'

export class UsageBucketsModel {
  static readonly HOUR_MS = 3_600_000
  static readonly DAY_MS = 86_400_000

  /** Every bucket start in the range, computed the way the Host groups rows, so empty buckets still show. */
  static bucketStarts(input: { readonly from: number; readonly to: number; readonly bucket: ChartBucket; readonly offsetMs: number }): number[] {
    const size = input.bucket === 'hour' ? UsageBucketsModel.HOUR_MS : UsageBucketsModel.DAY_MS
    const align = (at: number): number => Math.floor((at + input.offsetMs) / size) * size - input.offsetMs
    const starts: number[] = []
    for (let start = align(input.from); start < input.to && starts.length < 2_000; start += size) starts.push(start)
    return starts
  }

  /** Identity is the actual instant, never localized text (DST can repeat an hour). */
  static bucketKey(start: number): string {
    return String(start)
  }

  static bucketKeyLabel(key: string, bucket: ChartBucket, spansDays: boolean): string {
    return UsageBucketsModel.bucketLabel(Number(key), bucket, spansDays)
  }

  static bucketLabel(start: number, bucket: ChartBucket, spansDays: boolean): string {
    const date = new Date(start)
    if (bucket === 'day') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const hour = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    return spansDays ? `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hour}` : hour
  }

  /** Label at most ~8 ticks on a band axis; the rest keep their tick but no text. */
  static sparseTickFormat(labels: readonly string[]): (value: string) => string {
    const step = Math.max(1, Math.ceil(labels.length / 8))
    const shown = new Set(labels.filter((_, index) => index % step === 0))
    return value => (shown.has(value) ? value : '')
  }
}
