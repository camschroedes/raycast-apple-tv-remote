import { LaunchProps, Toast, showHUD, showToast } from "@raycast/api";
import { setText } from "@bharper/atv-js";
import { findAction, performAction } from "./lib/actions";
import { launchAppByName, resolveAppName } from "./lib/apps";
import { launchApp, skipBy } from "./lib/companion-extras";
import { withConnection } from "./lib/connection";
import { showErrorToast } from "./lib/errors";
import { playContent } from "./lib/play-flow";

/**
 * One-shot natural-language command: "pause", "open Netflix",
 * "play Rick and Morty on Netflix". Common phrases are handled instantly with
 * no AI; Raycast AI (when available) only resolves show titles to deep links.
 */

// Raycast's guidance: a HUD confirms success, a failure gets a Toast (which
// degrades to a HUD by itself when the window is closed).
async function openApp(appName: string): Promise<void> {
  const opened = await launchAppByName(appName);
  if (opened) {
    await showHUD(`📺 Opened ${opened.name}`);
    return;
  }
  await showToast({
    style: Toast.Style.Failure,
    title: "Unknown App",
    message: `Nothing on the Apple TV matches “${appName}”. Try the Launch Apple TV App command.`,
  });
}

export default async function Ask(props: LaunchProps<{ arguments: { query: string } }>) {
  const query = props.arguments.query.trim().toLowerCase();

  try {
    // 1. Any named remote action ("pause", "volume up", "app switcher", "sleep", …)
    const action = findAction(query);
    if (action) {
      await performAction(action);
      return;
    }

    // 2. Parameterised gestures: "skip 30", "skip back 15", "type hello"
    const skipMatch = query.match(/^skip(?:\s+(back|backward|forward))?\s+(\d+)$/);
    if (skipMatch) {
      const seconds = Number(skipMatch[2]) * (skipMatch[1]?.startsWith("back") ? -1 : 1);
      await withConnection((conn) => skipBy(conn, seconds));
      await showHUD(`${seconds > 0 ? "⏩" : "⏪"} ${Math.abs(seconds)}s`);
      return;
    }
    const typeMatch = query.match(/^type\s+(.+)$/);
    if (typeMatch) {
      await withConnection((conn) => setText(conn, typeMatch[1]));
      await showHUD("⌨️ Sent text to Apple TV");
      return;
    }

    // 3. "open/launch <app or URL>": URLs deep-link directly
    const openMatch = query.match(/^(?:open|launch|start|go to)\s+(.+)$/);
    if (openMatch) {
      const target = openMatch[1].trim();
      if (target.includes("://")) {
        await withConnection((conn) => launchApp(conn, target));
        await showHUD(`🔗 Sent ${target.split("/")[0]} link to Apple TV`);
        return;
      }
      await openApp(target);
      return;
    }

    // 4. "play/watch <title> [on <app>]"
    const playMatch = query.match(/^(?:play|watch)\s+(.+?)(?:\s+on\s+([a-z0-9+ ]+))?$/);
    if (playMatch) {
      const result = await playContent(playMatch[1], playMatch[2]);
      if (result.ok) {
        await showHUD(`▶️ ${result.message}`);
      } else {
        await showToast({ style: Toast.Style.Failure, title: "Couldn't Play That", message: result.message });
      }
      return;
    }

    // 5. Maybe it's just an app name ("netflix")
    if (resolveAppName(query)) {
      await openApp(query);
      return;
    }

    await showToast({
      style: Toast.Style.Failure,
      title: "Didn't Understand That",
      message: "Try “pause”, “open Netflix”, or “play <show> on <app>”.",
    });
  } catch (error) {
    await showErrorToast(error);
  }
}
