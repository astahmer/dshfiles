import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { Schema } from 'effect'

const PANEL_ID = 'dshfiles-whiteboard'

export const projectPreferences = (panelId: string | undefined) =>
  createStoredValue({
    key: panelId === undefined || panelId === PANEL_ID ? 'dshfiles-whiteboard:project' : `dshfiles-whiteboard:project/panel/${encodeURIComponent(panelId)}`,
    schema: Schema.NullOr(Schema.String),
    fallback: null,
  })
