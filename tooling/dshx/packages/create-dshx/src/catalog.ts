import { CLIENT_CAPABILITIES, CLIENT_SERVICES, DSH_PROTOCOL_2, HOST_CAPABILITIES, UNAVAILABLE_PROTOCOL_2_CAPABILITIES } from './capabilities.js'
import { CLIENT_SLOT_REFERENCES } from './slot-capabilities.js'

export const capabilityReport = () => ({
  schemaVersion: 1,
  generation: DSH_PROTOCOL_2.generation,
  verifiedDsh: DSH_PROTOCOL_2.version,
  clientServices: Object.entries(CLIENT_SERVICES).map(([name, descriptor]) => ({
    name,
    package: descriptor.packageName,
    availability: descriptor.availability,
  })),
  client: Object.entries(CLIENT_CAPABILITIES).map(([name, descriptor]) => ({
    name,
    services: [...descriptor.cordisServices],
    providers: [...descriptor.providers],
  })),
  host: Object.entries(HOST_CAPABILITIES).map(([name, descriptor]) => ({
    name,
    services: [...descriptor.cordisServices],
    providers: [...descriptor.providers],
  })),
  unavailable: Object.entries(UNAVAILABLE_PROTOCOL_2_CAPABILITIES).map(([name, reason]) => ({ name, reason })),
  slots: CLIENT_SLOT_REFERENCES,
})
