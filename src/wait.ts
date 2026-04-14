import { EcpTimeoutError } from './errors.js';
import { findElement, findFocused, type UiNode } from './ui.js';
import type { EcpClient, ActiveApp } from './client.js';

export interface WaitOptions {
  /** Timeout in ms. Default 10000. */
  timeout?: number;
  /** Poll interval in ms. Default 200. */
  interval?: number;
}

type TreeSource = () => Promise<UiNode>;

async function poll<T>(
  check: () => Promise<T | undefined>,
  opts: WaitOptions | undefined,
  label: string,
): Promise<T> {
  const timeout = opts?.timeout ?? 10000;
  const interval = opts?.interval ?? 200;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result !== undefined) return result;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new EcpTimeoutError(`${label}: timed out after ${timeout}ms`, timeout);
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
