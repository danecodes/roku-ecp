# roku-ecp

[![npm version](https://img.shields.io/npm/v/@danecodes/roku-ecp)](https://www.npmjs.com/package/@danecodes/roku-ecp)
[![CI](https://github.com/danecodes/roku-ecp/actions/workflows/ci.yml/badge.svg)](https://github.com/danecodes/roku-ecp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight TypeScript client for the Roku [External Control Protocol (ECP)](https://developer.roku.com/docs/developer-program/dev-tools/external-control-api.md). Companion library to [@danecodes/roku-mcp](https://github.com/danecodes/roku-mcp).

No WebDriver. No Appium. No Selenium. No Java. No native dependencies. Just HTTP to port 8060.

## Install

```bash
npm install @danecodes/roku-ecp
```

## Quick start

```typescript
import { EcpClient, Key, parseUiXml, findElement, findFocused } from '@danecodes/roku-ecp';

// Connect by IP
const roku = new EcpClient('192.168.0.30');

// Or discover on the network
// const roku = await EcpClient.discover();
// const allDevices = await EcpClient.discoverAll();

// Send remote control input
await roku.press(Key.Down, { times: 3 });
await roku.press(Key.Select);

// Type into a search field
await roku.type('one piece');

// Inspect the SceneGraph UI tree
const xml = await roku.queryAppUi();
const tree = parseUiXml(xml);
const button = findElement(tree, 'AppButton#play_button');
console.log(button?.attrs.text); // "Play"

// Check what's focused
const focused = findFocused(tree);
console.log(focused?.tag, focused?.attrs.name);

// Query device state
const info = await roku.queryDeviceInfo();
const app = await roku.queryActiveApp();
const player = await roku.queryMediaPlayer();
const apps = await roku.queryInstalledApps();
```

## API

### `EcpClient.discover(options?)`

Find a Roku on the local network via SSDP. Returns the first device found.

```typescript
const roku = await EcpClient.discover();                    // 5s timeout
const roku = await EcpClient.discover({ timeout: 10000 });  // custom timeout
const all = await EcpClient.discoverAll();                   // find all devices
```

### `new EcpClient(ip, options?)`

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `8060` | ECP HTTP port |
| `devPassword` | `"rokudev"` | Developer password for sideload/screenshot |
| `timeout` | `10000` | Request timeout in ms |
| `keyCooldown` | `0` | Minimum delay between key presses in ms |
| `webCooldown` | `0` | Minimum delay between web server requests in ms |

### Key input

```typescript
await roku.keypress(Key.Select);           // single press
await roku.keydown(Key.Right);             // key down
await roku.keyup(Key.Right);               // key up
await roku.press(Key.Down, { times: 5, delay: 100 }); // repeated press
await roku.type('search text', { delay: 50 });        // character-by-character
```

All standard Roku keys are available on the `Key` object: `Home`, `Back`, `Select`, `Up`, `Down`, `Left`, `Right`, `Play`, `Rev`, `Fwd`, `Info`, `Search`, `Enter`, `Backspace`, `InstantReplay`, `VolumeUp`, `VolumeDown`, `VolumeMute`, `PowerOn`, `PowerOff`, `InputHDMI1`–`4`, `InputAV1`, `InputTuner`.

### Touch input

```typescript
await roku.touch({ x: 100, y: 200 });                    // tap at coordinates
await roku.touch({ x: 100, y: 200, op: 'down' });       // touch down
await roku.touch({ x: 150, y: 250, op: 'move' });       // drag
await roku.touch({ x: 150, y: 250, op: 'up' });         // release
```

Roku's coordinate origin is bottom-left. Operations: `'press'` (default), `'down'`, `'up'`, `'move'`.

### App lifecycle

```typescript
await roku.launch('12345');                              // launch by channel ID
await roku.launch('dev', { contentId: 'abc', mediaType: 'episode' }); // with params
await roku.deepLink('dev', 'abc', 'episode');            // shorthand
await roku.install('12345');                             // install from store
await roku.input({ key: 'value' });                      // send input params
await roku.closeApp();                                   // press Home
```

### Queries

```typescript
const info = await roku.queryDeviceInfo();       // DeviceInfo
const app = await roku.queryActiveApp();         // ActiveApp
const apps = await roku.queryInstalledApps();    // InstalledApp[]
const player = await roku.queryMediaPlayer();    // MediaPlayerState
const xml = await roku.queryAppUi();             // raw XML string
const perf = await roku.queryChanperf();         // ChanperfSample
```

### Sideload & screenshot

```typescript
await roku.sideload('./build.zip');              // deploy dev channel (zip file)
await roku.sideload('./my-roku-app');            // deploy dev channel (directory)
const png = await roku.takeScreenshot();         // returns Buffer
```

Requires developer mode. Uses digest auth with the configured `devPassword`.

### Debug console (port 8085)

```typescript
const output = await roku.readConsole({ duration: 3000, filter: 'error' });
const response = await roku.sendConsoleCommand('bt'); // backtrace
```

## UI tree

Parse the SceneGraph XML and query it with CSS-like selectors:

```typescript
import { parseUiXml, findElement, findElements, findFocused, formatTree } from '@danecodes/roku-ecp';

const tree = parseUiXml(await roku.queryAppUi());

// Basic selectors
findElement(tree, 'AppButton#play');                    // tag#name
findElement(tree, '#titleLabel');                        // name only
findElement(tree, '*');                                  // universal (all nodes)

// Combinators
findElement(tree, 'HomePage BannerWidget');              // descendant
findElement(tree, 'LayoutGroup > AppLabel');             // direct child
findElement(tree, 'ContentRow + ContentRow'); // adjacent sibling
findElement(tree, 'NavMenu ~ LayoutGroup');              // general sibling (all following)
findElements(tree, 'PosterCard, ThumbnailCard');           // comma groups (union)

// Attributes
findElement(tree, '[focused="true"]');                   // exact value
findElement(tree, '[visible]');                          // existence
findElement(tree, '[text*="Log"]');                      // substring (contains)
findElement(tree, '[text^="Episode"]');                  // starts with
findElement(tree, '[uri$=".png"]');                      // ends with
findElement(tree, 'AppButton#play[focused="true"]');     // combined

// Pseudo-classes
findElement(tree, 'AppButton:nth-child(1)');             // nth-child (number)
findElements(tree, 'AppButton:nth-child(odd)');          // nth-child (odd/even)
findElements(tree, 'AppButton:nth-child(2n+1)');         // nth-child (formula)
findElement(tree, 'AppButton:first-child');              // first child
findElement(tree, 'AppButton:last-child');               // last child
findElement(tree, 'AppButton:only-child');               // sole child
findElement(tree, 'LayoutGroup:empty');                  // no children
findElement(tree, 'AppButton:not([focused="true"])');     // negation
findElement(tree, 'AppButton:has(AppLabel[text="Log Out"])'); // has matching descendant

findElements(tree, 'AppButton');  // all matches
findFocused(tree);                // currently focused node

console.log(formatTree(tree, { maxDepth: 3 }));
```

### `UiNode`

```typescript
interface UiNode {
  tag: string;                        // SceneGraph component name
  name?: string;                      // name or id attribute
  attrs: Record<string, string>;      // all XML attributes
  children: UiNode[];
  parent?: UiNode;
}
```

## Wait helpers

Poll the device until a condition is met, with configurable timeout and interval:

```typescript
import {
  waitFor, waitForElement, waitForFocus, waitForApp, waitForText, waitForStable,
} from '@danecodes/roku-ecp';

const getTree = async () => parseUiXml(await roku.queryAppUi());

// Wait for an element to appear
const el = await waitForElement(getTree, '#loginBtn');

// Wait for a specific element to gain focus
await waitForFocus(getTree, 'AppButton#play');

// Wait for any element to be focused (no selector)
const focused = await waitForFocus(getTree);

// Wait for an app to become active
await waitForApp(roku, '12345');

// Wait for text content to appear
await waitForText(getTree, '#title', 'Now Playing');

// Wait for UI to stabilize after animation (e.g. after a key press)
await roku.keypress(Key.Down);
await waitForStable(getTree, { interval: 150, timeout: 3000 });

// Generic: poll any custom condition
const state = await waitFor(async () => {
  const p = await roku.queryMediaPlayer();
  return p.state === 'play' ? p : undefined;
}, { timeout: 5000, label: 'waitForPlayback' });
```

All helpers accept `WaitOptions`:

| Option | Default | Description |
|--------|---------|-------------|
| `timeout` | `10000` | Max wait in ms (`waitForStable` defaults to `3000`) |
| `interval` | `200` | Poll interval in ms (`waitForStable` defaults to `150`) |

Transient `EcpTimeoutError` and `EcpHttpError` during polling are caught and retried until the deadline. Non-transient errors throw immediately.

## Typed errors

```typescript
import { EcpHttpError, EcpTimeoutError, EcpAuthError, EcpSideloadError, EcpScreenshotError } from '@danecodes/roku-ecp';

try {
  await roku.queryDeviceInfo();
} catch (err) {
  if (err instanceof EcpTimeoutError) // device unreachable
  if (err instanceof EcpHttpError)    // non-ok HTTP status { method, path, status, statusText }
  if (err instanceof EcpAuthError)    // digest auth failure { status }
}
```

## Console & log parsing

Powered by [@danecodes/roku-log](https://github.com/danecodes/roku-log). Quick issue scan:

```typescript
import { parseConsoleForIssues } from '@danecodes/roku-ecp';

const output = await roku.readConsole({ duration: 5000 });
const { errors, crashes, exceptions } = parseConsoleForIssues(output);
```

For structured parsing with file/line/function extraction:

```typescript
import { LogParser, LogStream, LogSession, LogFormatter } from '@danecodes/roku-ecp';

// Parse raw text into structured entries
const parser = new LogParser();
const entries = parser.parse(output);  // LogEntry[] with type, source, message

// Stream logs in real time
const stream = new LogStream('192.168.0.30');
stream.on('error', (err) => console.log(err.errorClass, err.source));
stream.on('crash', (bt) => console.log(bt.frames));
stream.on('beacon', (b) => console.log(b.event, b.duration));
await stream.connect();

// Aggregate and analyze
const session = new LogSession();
session.addAll(entries);
console.log(session.summary());  // { errorCount, crashCount, ... }

// Color-coded terminal output
const fmt = new LogFormatter({ color: true });
entries.forEach(e => console.log(fmt.format(e)));
```

## Requirements

- Roku device in developer mode on the same network
- Node.js 22+

## License

MIT
