/**
 * ECP (External Control Protocol) client for Roku devices.
 *
 * Typed API over Roku's HTTP-based ECP on port 8060.
 */

import { XMLParser } from 'fast-xml-parser';
import { createConnection } from 'net';
import { readFile, stat, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { ZipFile } from 'yazl';
import { EcpHttpError, EcpTimeoutError } from './errors.js';
import { digestGet, digestUpload } from './digest.js';
import { ssdpDiscover, ssdpDiscoverAll } from './ssdp.js';

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
/*  Errors                                                            */
/* ------------------------------------------------------------------ */

export class EcpSideloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcpSideloadError';
  }
}

export class EcpScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EcpScreenshotError';
  }
}

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
    let fileData: Buffer;

    if (info.isDirectory()) {
      fileData = await zipDirectory(pathOrDir);
    } else {
      fileData = await readFile(pathOrDir);
    }

    const html = await digestUpload(
      `http://${this.deviceIp}/plugin_install`,
      'rokudev',
      this.devPassword,
      { mysubmit: 'Install' },
      { archive: { filename: 'sideload.zip', data: fileData } },
    );
    if (html.includes('Install Success')) return 'Install Success';
    if (html.includes('Install Failure')) {
      throw new EcpSideloadError('Sideload failed — check the package');
    }
    return 'Sideload completed';
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

    await digestUpload(
      `${devUrl}/plugin_inspect`,
      'rokudev',
      this.devPassword,
      { mysubmit: 'Screenshot' },
      {},
    );

    const png = await digestGet(
      `${devUrl}/pkgs/dev.png?time=${Date.now()}`,
      'rokudev',
      this.devPassword,
    );

    if (png.length < 1000) {
      throw new EcpScreenshotError('Screenshot failed — is a dev channel sideloaded?');
    }

    return png;
  }

  /* ---- SSDP Discovery ---- */

  static async discover(options?: { timeout?: number }): Promise<EcpClient> {
    return ssdpDiscover((ip, opts) => new EcpClient(ip, opts), options);
  }

  static async discoverAll(options?: { timeout?: number }): Promise<EcpClient[]> {
    return ssdpDiscoverAll((ip, opts) => new EcpClient(ip, opts), options);
  }

  /* ---- HTTP helpers ---- */

  private async get(path: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Connection: 'close' },
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
        headers: { Connection: 'close' },
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

/* ---- Zip helper ---- */

async function zipDirectory(dir: string): Promise<Buffer> {
  const zipfile = new ZipFile();
  await addDirToZip(zipfile, dir, dir);
  zipfile.end();

  const chunks: Buffer[] = [];
  for await (const chunk of zipfile.outputStream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function addDirToZip(zipfile: ZipFile, baseDir: string, currentDir: string): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const archivePath = relative(baseDir, fullPath);
    if (entry.isDirectory()) {
      await addDirToZip(zipfile, baseDir, fullPath);
    } else {
      zipfile.addFile(fullPath, archivePath);
    }
  }
}
