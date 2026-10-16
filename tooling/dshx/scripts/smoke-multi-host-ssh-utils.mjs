export const buildSshOptions = ({ sshKey, knownHosts, sshPort = 22 }) => [
  '-p',
  String(sshPort),
  '-F',
  '/dev/null',
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  `UserKnownHostsFile=${knownHosts}`,
  '-o',
  'GlobalKnownHostsFile=/dev/null',
  '-o',
  'IdentitiesOnly=yes',
  '-i',
  sshKey,
  '-o',
  'ForwardAgent=no',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ConnectTimeout=15',
]

export const quoteRemoteArgument = value => `'${value.replaceAll("'", "'\\''")}'`

export const redactLaunchSecrets = value =>
  String(value)
    .replace(/http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~-]+/g, '<launch-url-redacted>')
    .replace(/token=[A-Za-z0-9._~-]+/g, 'token=<redacted>')
