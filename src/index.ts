export {
  EcpClient,
  EcpSideloadError,
  EcpScreenshotError,
  Key,
  type KeyName,
  type DeviceInfo,
  type ActiveApp,
  type MediaPlayerState,
  type InstalledApp,
  type ChanperfSample,
  type EcpClientOptions,
} from './client.js';

export {
  parseUiXml,
  findElement,
  findElements,
  findFocused,
  formatTree,
  type UiNode,
  type FormatOptions,
} from './ui.js';

export {
  parseConsoleForIssues,
  type ConsoleIssues,
} from './console.js';

export {
  EcpHttpError,
  EcpTimeoutError,
  EcpAuthError,
} from './errors.js';

export {
  waitForElement,
  waitForFocus,
  waitForApp,
  waitForText,
  type WaitOptions,
} from './wait.js';
