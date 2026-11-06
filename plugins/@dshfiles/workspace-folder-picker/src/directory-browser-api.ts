import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { WorkspaceFolderPickerSchema } from './schema.js'

const MAX_PATH_LENGTH = 8_192
const MAX_DIRECTORY_ENTRIES = 1_000
const MAX_BREADCRUMBS = 8_192
const MAX_ENTRY_NAME_LENGTH = 255

const directoryEntrySchema = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(MAX_ENTRY_NAME_LENGTH)),
  path: Schema.String.check(Schema.isMaxLength(MAX_PATH_LENGTH)),
  hidden: Schema.Boolean,
})

const directoryListingSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(MAX_PATH_LENGTH)),
  home: Schema.String.check(Schema.isMaxLength(MAX_PATH_LENGTH)),
  crumbs: Schema.Array(directoryEntrySchema).check(Schema.isMaxLength(MAX_BREADCRUMBS)),
  entries: Schema.Array(directoryEntrySchema).check(Schema.isMaxLength(MAX_DIRECTORY_ENTRIES)),
  truncated: Schema.Boolean,
})

export const workspaceFolderBrowserApi = defineApi({
  id: 'workspace-folder-picker.browser',
  version: 1,
  owner: '@dshfiles/workspace-folder-picker',
  methods: {
    capabilities: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({}),
      output: Schema.Struct({ nativePicker: Schema.Boolean }),
      description: 'Check whether this Host offers its native folder-selection dialog without opening it.',
      tool: {
        name: 'workspace_folder_browser_capabilities',
        readOnly: true,
        render: capability => (capability.nativePicker ? 'Native folder selection available' : 'Paste an absolute path or browse folders in the app'),
      },
    }),
    list: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({ path: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PATH_LENGTH))) }),
      output: directoryListingSchema,
      description: 'Browse one local directory for the user. Only call when the user asks to inspect local folders.',
      tool: {
        name: 'workspace_folder_browser_list',
        readOnly: true,
        render: listing => `${listing.entries.length} entries in ${listing.path}`,
      },
    }),
    createDirectory: WorkspaceFolderPickerSchema.method({
      input: Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PATH_LENGTH)),
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_ENTRY_NAME_LENGTH)),
      }),
      output: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PATH_LENGTH)),
      description: 'Create a child directory in an existing folder; only run when the user explicitly asks to create a folder.',
      tool: {
        name: 'workspace_folder_browser_create_directory',
        render: path => `Created ${path}`,
      },
    }),
  },
})
