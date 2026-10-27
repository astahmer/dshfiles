import { withSpan } from '@dshfiles/dshx/tracing'

export class BacklogTweetContextSpan {
  static readonly run = <T>(input: { readonly itemId: number; readonly work: () => Promise<T> }): Promise<T> =>
    withSpan(
      'backlog tweet import',
      { kind: 'internal', attributes: { 'dshx.plugin.package': '@dshfiles/backlog', 'dshx.backlog.item_id': input.itemId } },
      async span => {
        try {
          const result = await input.work()
          span.setAttribute('dshx.backlog.tweet_import.outcome', 'succeeded')
          return result
        } catch (error) {
          span.setAttribute('dshx.backlog.tweet_import.outcome', 'failed')
          throw error
        }
      },
    )
}
