/**
 * ECP (External Control Protocol) client for Roku devices.
 *
 * Typed API over Roku's HTTP-based ECP on port 8060.
 */

import { XMLParser } from 'fast-xml-parser';
import { createConnection } from 'net';
import { createHash } from 'crypto';
import { readFile, stat, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
import { EcpHttpError, EcpTimeoutError, EcpAuthError } from './errors.js';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface DeviceInfo {
  modelName: string;
  modelNumber: string;
  softwareVersion: string;
  softwareBuild: string;
  serialNumber: string;
  deviceId: string;
  friendlyName: string;
  networkType: string;
  networkName: string;
  isTv: boolean;
  uiResolution: string;
  [key: string]: string | boolean;
}

export interface ActiveApp {
  id: string;
  type: string;
  version: string;
  name: string;
}

export interface MediaPlayerState {
  state: string;
  error: boolean;
  plugin?: {
    id: string;
    name: string;
    bandwidth: string;
  };
  format?: {
    audio: string;
    video: string;
    captions: string;
    drm: string;
  };
  position?: string;
  duration?: string;
  isLive?: boolean;
}

export interface InstalledApp {
  id: string;
  type: string;
  version: string;
  name: string;
}

export interface ChanperfSample {
  cpuUser: number;
  cpuSystem: number;
  memAnon: number;
  memFile: number;
}

/* ------------------------------------------------------------------ */
/*  Keys                                                              */
/* ------------------------------------------------------------------ */

export const Key = {
  Home: 'Home',
  Rev: 'Rev',
  Fwd: 'Fwd',
  Play: 'Play',
  Select: 'Select',
  Left: 'Left',
  Right: 'Right',
  Down: 'Down',
  Up: 'Up',
  Back: 'Back',
  InstantReplay: 'InstantReplay',
  Info: 'Info',
  Backspace: 'Backspace',
  Search: 'Search',
  Enter: 'Enter',
  VolumeDown: 'VolumeDown',
  VolumeMute: 'VolumeMute',
  VolumeUp: 'VolumeUp',
  PowerOff: 'PowerOff',
  PowerOn: 'PowerOn',
  InputTuner: 'InputTuner',
  InputHDMI1: 'InputHDMI1',
  InputHDMI2: 'InputHDMI2',
  InputHDMI3: 'InputHDMI3',
  InputHDMI4: 'InputHDMI4',
  InputAV1: 'InputAV1',
} as const;

export type KeyName = (typeof Key)[keyof typeof Key];

/* ------------------------------------------------------------------ */
/*  Client options                                                     */
/* ------------------------------------------------------------------ */

export interface EcpClientOptions {
  /** Port for ECP HTTP API. Default 8060. */
  port?: number;
  /** Developer password for sideload/screenshot. Default "rokudev". */
  devPassword?: string;
  /** Request timeout in ms. Default 10000. */
  timeout?: number;
}

/* ------------------------------------------------------------------ */
/*  XML parsers                                                        */
/* ------------------------------------------------------------------ */

const flatParser = new XMLParser({
  ignoreAttributes: true,
});

const attrParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */

export class EcpClient {
  readonly baseUrl: string;
  private devPassword: string;
  private timeout: number;

  constructor(readonly deviceIp: string, options?: EcpClientOptions) {
    const port = options?.port ?? 8060;
    this.baseUrl = `http://${deviceIp}:${port}`;
    this.devPassword = options?.devPassword ?? 'rokudev';
    this.timeout = options?.timeout ?? 10000;
  }

  /* ---- Key input ---- */

  async keypress(key: KeyName | string): Promise<void> {
    await this.post(`/keypress/${key}`);
  }

  async keydown(key: KeyName | string): Promise<void> {
    await this.post(`/keydown/${key}`);
  }

  async keyup(key: KeyName | string): Promise<void> {
    await this.post(`/keyup/${key}`);
  }

  async press(
    key: KeyName | string,
    options?: { times?: number; delay?: number }
  ): Promise<void> {
    const times = options?.times ?? 1;
    const delay = options?.delay ?? 100;
    for (let i = 0; i < times; i++) {
      await this.keypress(key);
      if (i < times - 1 && delay > 0) {
        await sleep(delay);
      }
    }
  }

  async type(text: string, options?: { delay?: number }): Promise<void> {
    const delay = options?.delay ?? 50;
    for (const char of text) {
      await this.keypress(`Lit_${encodeURIComponent(char)}`);
      if (delay > 0) await sleep(delay);
    }
  }

  /* ---- App lifecycle ---- */

  async launch(
    channelId: string,
    params?: Record<string, string>
  ): Promise<void> {
    const qs = params
      ? '?' + new URLSearchParams(params).toString()
      : '';
    await this.post(`/launch/${channelId}${qs}`);
  }

  async install(channelId: string): Promise<void> {
    await this.post(`/install/${channelId}`);
  }

  async input(params: Record<string, string>): Promise<void> {
    const qs = new URLSearchParams(params).toString();
    await this.post(`/input?${qs}`);
  }

  async closeApp(): Promise<void> {
    await this.keypress('Home');
  }

  async deepLink(
    channelId: string,
    contentId: string,
    mediaType?: string
  ): Promise<void> {
    const params: Record<string, string> = { contentId };
    if (mediaType) params.mediaType = mediaType;
    await this.launch(channelId, params);
  }

  /* ---- Sideload ---- */

  async sideload(pathOrDir: string): Promise<string> {
    const info = await stat(pathOrDir);
    let zipPath: string;
    let tempDir: string | undefined;

    if (info.isDirectory()) {
      tempDir = await mkdtemp(join(tmpdir(), 'roku-ecp-'));
      zipPath = join(tempDir, 'sideload.zip');
      await execFileAsync('zip', ['-r', zipPath, '.'], { cwd: pathOrDir });
    } else {
      zipPath = pathOrDir;
    }

    try {
      const fileData = await readFile(zipPath);
      const html = await digestUpload(
        `http://${this.deviceIp}/plugin_install`,
        'rokudev',
        this.devPassword,
        { mysubmit: 'Install' },
        { archive: { filename: 'sideload.zip', data: fileData } },
      );
      if (html.includes('Install Success')) return 'Install Success';
      if (html.includes('Install Failure')) {
        throw new Error('Sideload failed — check the package');
      }
      return 'Sideload completed';
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true }).catch(() => {});
    }
  }

  /* ---- Console / Debug (port 8085) ---- */

  async readConsole(options?: {
    duration?: number;
    filter?: string;
  }): Promise<string> {
    const duration = options?.duration ?? 2000;
    const output = await tcpRead(this.deviceIp, 8085, '\n', duration);
    if (!options?.filter) return output;
    return output
      .split('\n')
      .filter((line) =>
        line.toLowerCase().includes(options.filter!.toLowerCase())
      )
      .join('\n');
  }

  async sendConsoleCommand(
    command: string,
    options?: { duration?: number }
  ): Promise<string> {
    const duration = options?.duration ?? 2000;
    return tcpRead(this.deviceIp, 8085, command + '\n', duration);
  }

  /* ---- Queries ---- */

  async queryDeviceInfo(): Promise<DeviceInfo> {
    const xml = await this.get('/query/device-info');
    const parsed = flatParser.parse(xml);
    const raw = parsed['device-info'];
    const info: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(raw)) {
      const v = String(value);
      if (v === 'true') info[toCamelCase(key)] = true;
      else if (v === 'false') info[toCamelCase(key)] = false;
      else info[toCamelCase(key)] = v;
    }
    return info as unknown as DeviceInfo;
  }

  async queryActiveApp(): Promise<ActiveApp> {
    const xml = await this.get('/query/active-app');
    const parsed = attrParser.parse(xml);
    const app = parsed['active-app']?.app;
    if (!app || typeof app === 'string') {
      return { id: '', type: 'home', version: '', name: app ?? 'Roku' };
    }
    return {
      id: String(app['@_id'] ?? ''),
      type: String(app['@_type'] ?? 'home'),
      version: String(app['@_version'] ?? ''),
      name: String(app['#text'] ?? 'Roku'),
    };
  }

  async queryInstalledApps(): Promise<InstalledApp[]> {
    const xml = await this.get('/query/apps');
    const parsed = attrParser.parse(xml);
    const apps = parsed.apps?.app;
    if (!apps) return [];
    const list = Array.isArray(apps) ? apps : [apps];
    return list.map((app: Record<string, unknown>) => ({
      id: String(app['@_id']),
      type: String(app['@_type']),
      version: String(app['@_version']),
      name: String(app['#text']),
    }));
  }

  async queryMediaPlayer(): Promise<MediaPlayerState> {
    const xml = await this.get('/query/media-player');
    const parsed = attrParser.parse(xml);
    const player = parsed.player;
    const plugin = player?.plugin;
    const format = player?.format;
    return {
      state: String(player['@_state'] ?? 'none'),
      error: player['@_error'] === 'true',
      plugin: plugin
        ? {
            id: String(plugin['@_id']),
            name: String(plugin['@_name']),
            bandwidth: String(plugin['@_bandwidth']),
          }
        : undefined,
      format: format
        ? {
            audio: String(format['@_audio']),
            video: String(format['@_video']),
            captions: String(format['@_captions']),
            drm: String(format['@_drm']),
          }
        : undefined,
      position: player.position ? String(player.position) : undefined,
      duration: player.duration ? String(player.duration) : undefined,
      isLive: (() => {
        const v = player.is_live?.['#text'] ?? player.is_live;
        if (v === true || v === 'true') return true;
        if (v === false || v === 'false') return false;
        return undefined;
      })(),
    };
  }

  async queryAppUi(): Promise<string> {
    return this.get('/query/app-ui');
  }

  async queryChanperf(): Promise<ChanperfSample> {
    const xml = await this.get('/query/chanperf');
    const parsed = flatParser.parse(xml);
    const plugin = parsed.chanperf?.plugin;
    if (!plugin) {
      return { cpuUser: 0, cpuSystem: 0, memAnon: 0, memFile: 0 };
    }
    const cpu = plugin['cpu-percent'] ?? {};
    const mem = plugin.memory ?? {};
    return {
      cpuUser: parseFloat(cpu.user ?? '0'),
      cpuSystem: parseFloat(cpu.sys ?? '0'),
      memAnon: parseInt(String(mem.anon ?? '0'), 10),
      memFile: parseInt(String(mem.file ?? '0'), 10),
    };
  }

  /* ---- Screenshot ---- */

  async takeScreenshot(): Promise<Buffer> {
    const devUrl = `http://${this.deviceIp}`;
    const auth = `rokudev:${this.devPassword}`;

    // Step 1: Trigger screenshot
    await digestUpload(
      `${devUrl}/plugin_inspect`,
      'rokudev',
      this.devPassword,
      { mysubmit: 'Screenshot' },
      {},
    );

    // Step 2: Download PNG with digest auth
    const png = await digestGet(
      `${devUrl}/pkgs/dev.png?time=${Date.now()}`,
      'rokudev',
      this.devPassword,
    );

    if (png.length < 1000) {
      throw new Error('Screenshot failed — is a dev channel sideloaded?');
    }

    return png;
  }

  /* ---- SSDP Discovery ---- */

  /**
   * Discover Roku devices on the local network via SSDP.
   * Returns the first device found, or throws after timeout.
   */
  static async discover(options?: { timeout?: number }): Promise<EcpClient> {
    const timeout = options?.timeout ?? 5000;
    const dgram = await import('dgram');

    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`No Roku device found within ${timeout}ms`));
      }, timeout);

      const message = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'ST: roku:ecp\r\n' +
        'MX: 3\r\n' +
        '\r\n'
      );

      socket.on('message', (msg) => {
        const response = msg.toString();
        const locationMatch = response.match(/LOCATION:\s*(.*)/i);
        if (locationMatch) {
          const url = new URL(locationMatch[1].trim());
          clearTimeout(timer);
          socket.close();
          resolve(new EcpClient(url.hostname, { port: parseInt(url.port) || 8060 }));
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.close();
        reject(err);
      });

      socket.bind(() => {
        socket.addMembership('239.255.255.250');
        socket.send(message, 0, message.length, 1900, '239.255.255.250');
      });
    });
  }

  /**
   * Discover all Roku devices on the local network via SSDP.
   */
  static async discoverAll(options?: { timeout?: number }): Promise<EcpClient[]> {
    const timeout = options?.timeout ?? 5000;
    const dgram = await import('dgram');
    const found = new Map<string, EcpClient>();

    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        socket.close();
        resolve([...found.values()]);
      }, timeout);

      const message = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'ST: roku:ecp\r\n' +
        'MX: 3\r\n' +
        '\r\n'
      );

      socket.on('message', (msg) => {
        const response = msg.toString();
        const locationMatch = response.match(/LOCATION:\s*(.*)/i);
        if (locationMatch) {
          const url = new URL(locationMatch[1].trim());
          if (!found.has(url.hostname)) {
            found.set(url.hostname, new EcpClient(url.hostname, {
              port: parseInt(url.port) || 8060,
            }));
          }
        }
      });

      socket.on('error', () => {
        clearTimeout(timer);
        socket.close();
        resolve([...found.values()]);
      });

      socket.bind(() => {
        socket.addMembership('239.255.255.250');
        socket.send(message, 0, message.length, 1900, '239.255.255.250');
      });
    });
  }

  /* ---- HTTP helpers ---- */

  private async get(path: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new EcpTimeoutError(`ECP GET ${path} timed out after ${this.timeout}ms`, this.timeout);
      }
      throw err;
    }
    if (!res.ok) {
      throw new EcpHttpError('GET', path, res.status, res.statusText);
    }
    return res.text();
  }

  private async post(path: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new EcpTimeoutError(`ECP POST ${path} timed out after ${this.timeout}ms`, this.timeout);
      }
      throw err;
    }
    if (!res.ok) {
      throw new EcpHttpError('POST', path, res.status, res.statusText);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/* ---- TCP read (replaces nc) ---- */

function tcpRead(host: string, port: number, input: string, duration: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection({ host, port }, () => {
      socket.write(input);
    });

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('utf-8'));
    }, duration);

    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      if (chunks.length > 0) {
        resolve(Buffer.concat(chunks).toString('utf-8'));
      } else {
        reject(err);
      }
    });
  });
}

/* ---- Digest auth (replaces curl --digest) ---- */

function md5(str: string): string {
  return createHash('md5').update(str).digest('hex');
}

function parseDigestChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^\s,]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] ?? match[3];
  }
  return params;
}

function buildDigestHeader(
  method: string,
  uri: string,
  username: string,
  password: string,
  challenge: Record<string, string>,
  nc: number
): string {
  const ncHex = nc.toString(16).padStart(8, '0');
  const cnonce = md5(String(Math.random()) + String(Date.now()));
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = challenge.qop
    ? md5(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.qop) {
    parts.push(`qop=${challenge.qop}`, `nc=${ncHex}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  return `Digest ${parts.join(', ')}`;
}

async function digestGet(url: string, username: string, password: string): Promise<Buffer> {
  // Step 1: Get 401 with challenge
  const initial = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (initial.ok) return Buffer.from(await initial.bytes());

  const wwwAuth = initial.headers.get('www-authenticate');
  if (!wwwAuth || initial.status !== 401) {
    throw new EcpAuthError(`Digest auth failed: ${initial.status}`, initial.status);
  }

  const challenge = parseDigestChallenge(wwwAuth);
  const uri = new URL(url).pathname + new URL(url).search;
  const authHeader = buildDigestHeader('GET', uri, username, password, challenge, 1);

  const res = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: authHeader },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new EcpAuthError(`Digest GET failed: ${res.status}`, res.status);
  return Buffer.from(await res.bytes());
}

async function digestUpload(
  url: string,
  username: string,
  password: string,
  fields: Record<string, string>,
  files: Record<string, { filename: string; data: Buffer }>,
): Promise<string> {
  const boundary = `----FormBoundary${Date.now()}`;

  function buildBody(): Buffer {
    const parts: Buffer[] = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      ));
    }
    for (const [name, file] of Object.entries(files)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ));
      parts.push(file.data);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(parts);
  }

  // Step 1: Get 401 challenge — no need to send the body yet
  const initial = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(60000),
  });

  if (initial.ok) return initial.text();

  const wwwAuth = initial.headers.get('www-authenticate');
  if (!wwwAuth || initial.status !== 401) {
    throw new EcpAuthError(`Digest auth failed: ${initial.status}`, initial.status);
  }

  // Step 2: Retry with digest auth
  const challenge = parseDigestChallenge(wwwAuth);
  const uri = new URL(url).pathname;
  const authHeader = buildDigestHeader('POST', uri, username, password, challenge, 1);

  const retryBody = buildBody();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: authHeader,
    },
    body: new Uint8Array(retryBody),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new EcpAuthError(`Digest upload failed: ${res.status}`, res.status);
  return res.text();
}
