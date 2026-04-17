import { EcpTimeoutError, EcpHttpError } from './errors.js';
import { findElement, findFocused, type UiNode } from './ui.js';
import type { EcpClient, ActiveApp } from './client.js';

export interface WaitOptions {
  /** Timeout in ms. Default 10000. */
  timeout?: number;
  /** Poll interval in ms. Default 200. */
  interval?: number;
}

type TreeSource = () => Promise<UiNode>;

function isTransient(err: unknown): boolean {
  return err instanceof EcpTimeoutError || err instanceof EcpHttpError;
}

async function poll<T>(
  check: () => Promise<T | undefined>,
  opts: WaitOptions | undefined,
  label: string,
): Promise<T> {
  const timeout = opts?.timeout ?? 10000;
  const interval = opts?.interval ?? 200;
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result !== undefined) return result;
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastError = err;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw lastError ?? new EcpTimeoutError(`${label}: timed out after ${timeout}ms`, timeout);
}

/** Poll until a custom condition returns a defined value. */
export async function waitFor<T>(
  check: () => Promise<T | undefined>,
  opts?: WaitOptions & { label?: string },
): Promise<T> {
  return poll(check, opts, opts?.label ?? 'waitFor');
}

/** Poll until an element matching `selector` disappears from the UI tree. */
export async function waitForElementGone(
  getTree: TreeSource,
  selector: string,
  opts?: WaitOptions,
): Promise<void> {
  await poll(
    async () => {
      const el = findElement(await getTree(), selector);
      return el === undefined ? true : undefined;
    },
    opts,
    `waitForElementGone(${selector})`,
  );
}

/** Poll until an element matching `selector` appears in the UI tree. */
export async function waitForElement(
  getTree: TreeSource,
  selector: string,
  opts?: WaitOptions,
): Promise<UiNode> {
  return poll(
    async () => findElement(await getTree(), selector),
    opts,
    `waitForElement(${selector})`,
  );
}

/** Poll until a focused element is found. If `selector` is given, waits until that specific element has focus. */
export async function waitForFocus(
  getTree: TreeSource,
  selector?: string,
  opts?: WaitOptions,
): Promise<UiNode> {
  return poll(
    async () => {
      const tree = await getTree();
      if (selector) {
        const el = findElement(tree, selector);
        return el?.attrs.focused === 'true' ? el : undefined;
      }
      return findFocused(tree);
    },
    opts,
    `waitForFocus(${selector ?? '*'})`,
  );
}

/** Poll until the active app matches `appId`. */
export async function waitForApp(
  client: EcpClient,
  appId: string,
  opts?: WaitOptions,
): Promise<ActiveApp> {
  return poll(
    async () => {
      const app = await client.queryActiveApp();
      return app.id === appId ? app : undefined;
    },
    opts,
    `waitForApp(${appId})`,
  );
}

/** Poll until two consecutive snapshots agree on the focused element. */
export async function waitForStable(
  getTree: TreeSource,
  opts?: WaitOptions,
): Promise<UiNode> {
  const timeout = opts?.timeout ?? 3000;
  const interval = opts?.interval ?? 150;
  const deadline = Date.now() + timeout;
  let prevId: string | undefined;
  let prevNode: UiNode | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const tree = await getTree();
      const focused = findFocused(tree);
      const curId = focused ? `${focused.tag}:${focused.attrs.name ?? focused.attrs.id ?? ''}` : undefined;
      if (curId !== undefined && curId === prevId) {
        return prevNode!;
      }
      prevId = curId;
      prevNode = focused;
    } catch (err) {
      if (!isTransient(err)) throw err;
      lastError = err;
      prevId = undefined;
      prevNode = undefined;
    }
    await new Promise(r => setTimeout(r, interval));
  }
  if (prevNode) return prevNode;
  throw lastError ?? new EcpTimeoutError(`waitForStable: timed out after ${timeout}ms`, timeout);
}

/** Poll until an element matching `selector` contains `text` in its text attribute. */
export async function waitForText(
  getTree: TreeSource,
  selector: string,
  text: string,
  opts?: WaitOptions,
): Promise<UiNode> {
  return poll(
    async () => {
      const el = findElement(await getTree(), selector);
      return el?.attrs.text?.includes(text) ? el : undefined;
    },
    opts,
    `waitForText(${selector}, "${text}")`,
  );
}
