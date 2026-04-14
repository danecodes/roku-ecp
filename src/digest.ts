import { createHash } from 'crypto';
import { EcpAuthError } from './errors.js';

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
  nc: number,
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

export async function digestGet(url: string, username: string, password: string): Promise<Buffer> {
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

export async function digestUpload(
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
