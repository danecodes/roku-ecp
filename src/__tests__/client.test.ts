import { describe, it, expect } from 'vitest';
import { EcpClient, Key } from '../client.js';

const ROKU_IP = process.env.ROKU_IP ?? '192.168.0.30';
const roku = new EcpClient(ROKU_IP);

describe('EcpClient', () => {
  describe('queryDeviceInfo', () => {
    it('returns device info with expected fields', async () => {
      const info = await roku.queryDeviceInfo();
      expect(info.modelName).toBeDefined();
      expect(info.serialNumber).toBeDefined();
      expect(info.softwareVersion).toBeDefined();
      expect(typeof info.isTv).toBe('boolean');
      expect(info.uiResolution).toBeDefined();
    });
  });

  describe('queryActiveApp', () => {
    it('returns the active app', async () => {
      const app = await roku.queryActiveApp();
      expect(app.name).toBeDefined();
      expect(typeof app.id).toBe('string');
    });
  });

  describe('queryInstalledApps', () => {
    it('returns an array of installed apps', async () => {
      const apps = await roku.queryInstalledApps();
      expect(Array.isArray(apps)).toBe(true);
      expect(apps.length).toBeGreaterThan(0);
      expect(apps[0].id).toBeDefined();
      expect(apps[0].name).toBeDefined();
    });
  });

  describe('queryMediaPlayer', () => {
    it('returns media player state', async () => {
      const state = await roku.queryMediaPlayer();
      expect(state.state).toBeDefined();
      expect(typeof state.error).toBe('boolean');
    });
  });

  describe('keypress', () => {
    it('sends a keypress without error', async () => {
      await expect(roku.keypress(Key.Info)).resolves.toBeUndefined();
    });
  });

  describe('press', () => {
    it('sends multiple keypresses', async () => {
      await expect(roku.press(Key.Down, { times: 2, delay: 50 })).resolves.toBeUndefined();
    });
  });

  describe('queryAppUi', () => {
    it('returns XML string', async () => {
      const xml = await roku.queryAppUi();
      expect(xml).toContain('<?xml');
    });
  });

  describe('constructor', () => {
    it('uses default port 8060', () => {
      const client = new EcpClient('10.0.0.1');
      expect(client.baseUrl).toBe('http://10.0.0.1:8060');
    });

    it('accepts custom port', () => {
      const client = new EcpClient('10.0.0.1', { port: 9090 });
      expect(client.baseUrl).toBe('http://10.0.0.1:9090');
    });

    it('times out on unreachable device', async () => {
      const client = new EcpClient('192.168.255.255', { timeout: 1000 });
      await expect(client.queryDeviceInfo()).rejects.toThrow();
    });
  });
});
