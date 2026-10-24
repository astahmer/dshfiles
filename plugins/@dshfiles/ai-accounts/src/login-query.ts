import type { QueryClient, QueryKey } from '@dshfiles/plugin-ui/query'

/** A pre-start status read must not publish an old completion over the new sign-in attempt. */
export const beginLoginQuery = async <T>(client: QueryClient, queryKey: QueryKey, begin: () => Promise<T>): Promise<T> => {
  await client.cancelQueries({ queryKey, exact: true })
  return begin()
}
