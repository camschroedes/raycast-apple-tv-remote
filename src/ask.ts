import { LaunchProps, showHUD } from "@raycast/api";
import { RemoteKey, sendKey } from "@bharper/atv-js";
import { withConnection } from "./lib/connection";
import { showErrorToast } from "./lib/errors";
import { launchApp, sleepDevice, wakeDevice } from "./lib/companion-extras";
import { resolveAppName } from "./lib/deep-links";
import { playContent } from "./lib/play-flow";

/**
 * One-shot natural-language command: "pause", "open Netflix",
 * "play Rick and Morty on Netflix". Common phrases are handled instantly with
 * no AI; Raycast AI (when available) only resolves show titles to deep links.
 */

const KEY_PHRASES: Record<string, RemoteKey> = {
  pause: RemoteKey.PlayPause,
  play: RemoteKey.PlayPause,
  resume: RemoteKey.PlayPause,
  up: RemoteKey.Up,
  down: RemoteKey.Down,
  left: RemoteKey.Left,
  right: RemoteKey.Right,
  select: RemoteKey.Select,
  ok: RemoteKey.Select,
  back: RemoteKey.Menu,
  menu: RemoteKey.Menu,
  home: RemoteKey.Home,
  next: RemoteKey.Next,
  skip: RemoteKey.Next,
  previous: RemoteKey.Previous,
  "volume up": RemoteKey.VolumeUp,
  louder: RemoteKey.VolumeUp,
  "volume down": RemoteKey.VolumeDown,
  quieter: RemoteKey.VolumeDown,
};

const HUD_LABELS: Partial<Record<RemoteKey, string>> = {
  [RemoteKey.PlayPause]: "⏯ Play/Pause",
  [RemoteKey.Home]: "🏠 Home",
  [RemoteKey.VolumeUp]: "🔊 Volume Up",
  [RemoteKey.VolumeDown]: "🔉 Volume Down",
};

async function pressKey(key: RemoteKey): Promise<void> {
  await withConnection((conn) => sendKey(conn, key));
  await showHUD(HUD_LABELS[key] ?? `Pressed ${key}`);
}

async function openApp(appName: string): Promise<void> {
  const resolved = resolveAppName(appName);
  if (!resolved) {
    await showHUD(`❓ Don't know the app “${appName}” — try the Launch Apple TV App command`);
    return;
  }
  await withConnection((conn) => launchApp(conn, resolved.bundleId));
  await showHUD(`📺 Opened ${resolved.name}`);
}

async function playTitle(title: string, appName?: string): Promise<void> {
  const result = await playContent(title, appName);
  await showHUD(`${result.ok ? "▶️" : "❓"} ${result.message}`);
}

export default async function Ask(props: LaunchProps<{ arguments: { query: string } }>) {
  const query = props.arguments.query.trim().toLowerCase();

  try {
    // 1. Direct key phrases ("pause", "volume up", …)
    const key = KEY_PHRASES[query];
    if (key) {
      await pressKey(key);
      return;
    }

    // 2. Power
    if (/^(sleep|turn off|off)$/.test(query)) {
      await withConnection(sleepDevice);
      await showHUD("😴 Apple TV going to sleep");
      return;
    }
    if (/^(wake|wake up|turn on|on)$/.test(query)) {
      await withConnection(wakeDevice);
      await showHUD("👋 Waking Apple TV");
      return;
    }

    // 3. "open/launch <app>"
    const openMatch = query.match(/^(?:open|launch|start|go to)\s+(.+)$/);
    if (openMatch) {
      await openApp(openMatch[1]);
      return;
    }

    // 4. "play/watch <title> [on <app>]"
    const playMatch = query.match(/^(?:play|watch)\s+(.+?)(?:\s+on\s+([a-z0-9+ ]+))?$/);
    if (playMatch) {
      await playTitle(playMatch[1], playMatch[2]);
      return;
    }

    // 5. Maybe it's just an app name ("netflix")
    if (resolveAppName(query)) {
      await openApp(query);
      return;
    }

    await showHUD(`❓ Try “pause”, “open Netflix”, or “play <show> on <app>”`);
  } catch (error) {
    await showErrorToast(error);
  }
}
