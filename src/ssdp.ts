import type { EcpClient } from './client.js';

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_MESSAGE = Buffer.from(
  'M-SEARCH * HTTP/1.1\r\n' +
  `HOST: ${SSDP_MULTICAST}:${SSDP_PORT}\r\n` +
  'MAN: "ssdp:discover"\r\n' +
  'ST: roku:ecp\r\n' +
  'MX: 3\r\n' +
  '\r\n'
);

function parseLocation(response: string): { hostname: string; port: number } | undefined {
  const match = response.match(/LOCATION:\s*(.*)/i);
  if (!match) return undefined;
  const url = new URL(match[1].trim());
  return { hostname: url.hostname, port: parseInt(url.port) || 8060 };
}

export async function ssdpDiscover(
  factory: (ip: string, opts: { port: number }) => EcpClient,
  options?: { timeout?: number },
): Promise<EcpClient> {
  const timeout = options?.timeout ?? 5000;
  const dgram = await import('dgram');

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`No Roku device found within ${timeout}ms`));
    }, timeout);

    socket.on('message', (msg) => {
      const loc = parseLocation(msg.toString());
      if (loc) {
        clearTimeout(timer);
        socket.close();
        resolve(factory(loc.hostname, { port: loc.port }));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      socket.addMembership(SSDP_MULTICAST);
      socket.send(SEARCH_MESSAGE, 0, SEARCH_MESSAGE.length, SSDP_PORT, SSDP_MULTICAST);
    });
  });
}

export async function ssdpDiscoverAll(
  factory: (ip: string, opts: { port: number }) => EcpClient,
  options?: { timeout?: number },
): Promise<EcpClient[]> {
  const timeout = options?.timeout ?? 5000;
  const dgram = await import('dgram');
  const found = new Map<string, EcpClient>();

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      resolve([...found.values()]);
    }, timeout);

    socket.on('message', (msg) => {
      const loc = parseLocation(msg.toString());
      if (loc && !found.has(loc.hostname)) {
        found.set(loc.hostname, factory(loc.hostname, { port: loc.port }));
      }
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.close();
      resolve([...found.values()]);
    });

    socket.bind(() => {
      socket.addMembership(SSDP_MULTICAST);
      socket.send(SEARCH_MESSAGE, 0, SEARCH_MESSAGE.length, SSDP_PORT, SSDP_MULTICAST);
    });
  });
}
