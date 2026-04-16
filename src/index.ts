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
  type TouchEvent,
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
  LogParser,
  LogStream,
  LogSession,
  LogFormatter,
  type ConsoleIssues,
  type LogEntry,
  type LogEntryType,
  type LogSource,
  type BrightScriptError,
  type Backtrace,
  type BacktraceFrame,
  type BeaconEntry,
  type CompileEntry,
  type LogStreamOptions,
  type LogFormatterOptions,
  type LogFilterOptions,
} from '@danecodes/roku-log';

export {
  EcpHttpError,
  EcpTimeoutError,
  EcpAuthError,
} from './errors.js';

export {
  waitFor,
  waitForElement,
  waitForFocus,
  waitForApp,
  waitForText,
  waitForStable,
  type WaitOptions,
} from './wait.js';
