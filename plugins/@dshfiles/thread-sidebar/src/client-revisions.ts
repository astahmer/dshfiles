import { decodeJson } from '@dshfiles/dshx/json'
import { Schema } from 'effect'

const revisionPairs = Schema.Array(Schema.Tuple([Schema.String, Schema.String]))

export const decodeClientRevisions = (key: string) => decodeJson(revisionPairs, key).map(([id, rev]) => ({ id, rev }))
