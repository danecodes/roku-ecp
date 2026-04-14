import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EcpClient, EcpHttpError, EcpTimeoutError } from '../index.js';

function mockFetch(xml: string, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(xml, { status })),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('queryDeviceInfo', () => {
  it('parses device info XML with camelCase keys and boolean conversion', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <device-info>
        <model-name>Roku Express</model-name>
        <model-number>3930X</model-number>
        <software-version>11.5.0</software-version>
        <software-build>4188</software-build>
        <serial-number>YH00AA000000</serial-number>
        <device-id>abc123</device-id>
        <friendly-name>Living Room Roku</friendly-name>
        <network-type>wifi</network-type>
        <network-name>MyWifi</network-name>
        <is-tv>false</is-tv>
        <ui-resolution>1080p</ui-resolution>
      </device-info>`);

    const client = new EcpClient('192.168.0.1');
    const info = await client.queryDeviceInfo();

    expect(info.modelName).toBe('Roku Express');
    expect(info.modelNumber).toBe('3930X');
    expect(info.serialNumber).toBe('YH00AA000000');
    expect(info.friendlyName).toBe('Living Room Roku');
    expect(info.isTv).toBe(false);
    expect(info.uiResolution).toBe('1080p');
  });

  it('converts boolean true', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <device-info>
        <is-tv>true</is-tv>
        <model-name>Roku TV</model-name>
        <model-number>7820X</model-number>
        <software-version>11.5.0</software-version>
        <software-build>4188</software-build>
        <serial-number>X</serial-number>
        <device-id>X</device-id>
        <friendly-name>TV</friendly-name>
        <network-type>ethernet</network-type>
        <network-name>LAN</network-name>
        <ui-resolution>4k</ui-resolution>
      </device-info>`);

    const client = new EcpClient('192.168.0.1');
    const info = await client.queryDeviceInfo();
    expect(info.isTv).toBe(true);
  });
});

describe('queryActiveApp', () => {
  it('parses active app', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <active-app>
        <app id="12345" type="appl" version="2.1.0">My App</app>
      </active-app>`);

    const client = new EcpClient('192.168.0.1');
    const app = await client.queryActiveApp();
    expect(app.id).toBe('12345');
    expect(app.type).toBe('appl');
    expect(app.version).toBe('2.1.0');
    expect(app.name).toBe('My App');
  });

  it('returns home screen when no app is active', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <active-app>
        <app>Roku</app>
      </active-app>`);

    const client = new EcpClient('192.168.0.1');
    const app = await client.queryActiveApp();
    expect(app.id).toBe('');
    expect(app.type).toBe('home');
  });
});

describe('queryInstalledApps', () => {
  it('parses multiple apps', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <apps>
        <app id="11111" type="appl" version="1.0">App One</app>
        <app id="22222" type="appl" version="2.0">App Two</app>
      </apps>`);

    const client = new EcpClient('192.168.0.1');
    const apps = await client.queryInstalledApps();
    expect(apps).toHaveLength(2);
    expect(apps[0].id).toBe('11111');
    expect(apps[0].name).toBe('App One');
    expect(apps[1].id).toBe('22222');
  });

  it('handles single app (not wrapped in array)', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <apps>
        <app id="11111" type="appl" version="1.0">Solo App</app>
      </apps>`);

    const client = new EcpClient('192.168.0.1');
    const apps = await client.queryInstalledApps();
    expect(apps).toHaveLength(1);
    expect(apps[0].name).toBe('Solo App');
  });

  it('returns empty array when no apps', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <apps></apps>`);

    const client = new EcpClient('192.168.0.1');
    const apps = await client.queryInstalledApps();
    expect(apps).toEqual([]);
  });
});

describe('queryMediaPlayer', () => {
  it('parses full media player state', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <player state="play" error="false">
        <plugin id="12345" name="My App" bandwidth="2000" />
        <format audio="aac" video="h264" captions="srt" drm="none" />
        <position>30000</position>
        <duration>120000</duration>
        <is_live>false</is_live>
      </player>`);

    const client = new EcpClient('192.168.0.1');
    const player = await client.queryMediaPlayer();
    expect(player.state).toBe('play');
    expect(player.error).toBe(false);
    expect(player.plugin?.id).toBe('12345');
    expect(player.format?.audio).toBe('aac');
    expect(player.position).toBe('30000');
    expect(player.duration).toBe('120000');
    expect(player.isLive).toBe(false);
  });

  it('isLive returns true', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <player state="play" error="false">
        <is_live>true</is_live>
      </player>`);

    const client = new EcpClient('192.168.0.1');
    const player = await client.queryMediaPlayer();
    expect(player.isLive).toBe(true);
  });

  it('handles minimal response without plugin/format', async () => {
    mockFetch(`<?xml version="1.0" encoding="UTF-8" ?>
      <player state="none" error="false" />`);

    const client = new EcpClient('192.168.0.1');
    const player = await client.queryMediaPlayer();
    expect(player.state).toBe('none');
    expect(player.error).toBe(false);
    expect(player.plugin).toBeUndefined();
    expect(player.format).toBeUndefined();
    expect(player.isLive).toBeUndefined();
  });
});

describe('typed errors', () => {
  it('throws EcpHttpError on non-ok response', async () => {
    mockFetch('Not Found', 404);

    const client = new EcpClient('192.168.0.1');
    await expect(client.queryDeviceInfo()).rejects.toThrow(EcpHttpError);
    try {
      await client.queryDeviceInfo();
    } catch (err) {
      expect(err).toBeInstanceOf(EcpHttpError);
      expect((err as EcpHttpError).status).toBe(404);
      expect((err as EcpHttpError).method).toBe('GET');
    }
  });

  it('throws EcpTimeoutError on timeout', async () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));

    const client = new EcpClient('192.168.0.1');
    await expect(client.queryDeviceInfo()).rejects.toThrow(EcpTimeoutError);
  });
});
