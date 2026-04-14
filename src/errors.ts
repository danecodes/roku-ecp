export class EcpHttpError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(`ECP ${method} ${path} failed: ${status} ${statusText}`);
    this.name = 'EcpHttpError';
  }
}

export class EcpTimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'EcpTimeoutError';
  }
}

export class EcpAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'EcpAuthError';
  }
}
