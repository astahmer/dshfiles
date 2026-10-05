export {
  createProject,
  DEFAULT_DSH_RANGE,
  DEFAULT_DSH_VERSION,
  DEFAULT_STYLE,
  DEFAULT_TEMPLATE,
  detectPackageManager,
  packageVersion,
  validateProjectName,
} from './create.js'
export { capabilityReport } from './catalog.js'
export {
  CLIENT_CAPABILITIES,
  CLIENT_SERVICES,
  DSH_PACKAGES,
  DSH_PROTOCOL_2,
  HOST_CAPABILITIES,
  SDK_RUNTIME_DEPENDENCIES,
  UNAVAILABLE_PROTOCOL_2_CAPABILITIES,
} from './capabilities.js'
export { CLIENT_CAPABILITY_INJECTIONS, CLIENT_DEFAULT_SERVICES, HOST_CAPABILITY_INJECTIONS } from './runtime-capabilities.js'
export { CLIENT_SLOT_REFERENCES, type ClientSlotReference } from './slot-capabilities.js'
export type { ClientNativeService } from './capabilities.js'
export type { CreateDependencies } from './create.js'
export type {
  CommandResult,
  CommandRunner,
  CreateDiagnostic,
  CreateIO,
  CreateProjectOptions,
  CreateProjectResult,
  FileSystem,
  PackageManager,
  ProjectStyle,
  TemplateName,
} from './types.js'
export { runCreate } from './cli.js'
