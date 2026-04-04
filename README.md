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
const roku = await EcpClient.discover();
const allDevices = await EcpClient.discoverAll();

// Send remote control input
await roku.press(Key.Down, { times: 3 });
await roku.press(Key.Select);

// Type into a search field
await roku.type('one piece');

// Inspect the SceneGraph UI tree
const xml = await roku.queryAppUi();
const tree = await parseUiXml(xml);
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

### Key input

```typescript
await roku.keypress(Key.Select);           // single press
await roku.keydown(Key.Right);             // key down
await roku.keyup(Key.Right);               // key up
await roku.press(Key.Down, { times: 5, delay: 100 }); // repeated press
await roku.type('search text', { delay: 50 });        // character-by-character
```

All standard Roku keys are available on the `Key` object: `Home`, `Back`, `Select`, `Up`, `Down`, `Left`, `Right`, `Play`, `Rev`, `Fwd`, `Info`, `Search`, `Enter`, `Backspace`, `InstantReplay`, `VolumeUp`, `VolumeDown`, `VolumeMute`, `PowerOn`, `PowerOff`, `InputHDMI1`–`4`, `InputAV1`, `InputTuner`.

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
await roku.sideload('./build.zip');              // deploy dev channel
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

findElement(tree, 'AppButton#play');                    // by tag#name
findElement(tree, '#titleLabel');                        // by name only
findElement(tree, 'HomePage HomeHeroCarousel');          // descendant
findElement(tree, 'LayoutGroup > AppLabel');             // direct child
findElement(tree, 'AppButton:nth-child(1)');             // nth-child
findElement(tree, 'CollectionModule + CollectionModule'); // adjacent sibling

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

## Console parser

Scan BrightScript debug output for issues:

```typescript
import { parseConsoleForIssues } from '@danecodes/roku-ecp';

const output = await roku.readConsole({ duration: 5000 });
const { errors, crashes, exceptions } = parseConsoleForIssues(output);
```

- **errors** — `BRIGHTSCRIPT: ERROR`, `Runtime Error`
- **crashes** — `Backtrace`, `-- crash`, `BRIGHTSCRIPT STOP`
- **exceptions** — `STOP in file`, `PAUSE in file`

## Requirements

- Roku device in developer mode on the same network
- Node.js 18+

## License

MIT
