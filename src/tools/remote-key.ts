import { RemoteKey, sendKey } from "@bharper/atv-js";
import { withConnection } from "../lib/connection";

type Input = {
  /**
   * The remote key to press. One of: up, down, left, right, select, menu, home,
   * play_pause, volume_up, volume_down, next, previous, top_menu, home_hold,
   * skip_forward, skip_backward, guide
   */
  key: string;
};

const VALID_KEYS = new Set<string>(Object.values(RemoteKey));

/**
 * Press a single button on the Apple TV remote (navigation, playback, volume, etc.).
 */
export default async function tool(input: Input): Promise<string> {
  const key = input.key.trim().toLowerCase();

  if (!VALID_KEYS.has(key)) {
    return `Invalid key "${input.key}". Valid keys: ${[...VALID_KEYS].join(", ")}.`;
  }

  try {
    await withConnection((conn) => sendKey(conn, key));
    return `Pressed ${key}`;
  } catch (error) {
    return `Failed to press ${key}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
