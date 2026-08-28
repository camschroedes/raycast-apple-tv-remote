import { AppleTVConnection, RemoteKey, sendKey } from "@bharper/atv-js";
import { showHUD } from "@raycast/api";
import {
  appSwitcher,
  controlCenter,
  longPressSelect,
  skipBy,
  sleepDevice,
  startScreensaver,
  wakeDevice,
} from "./companion-extras";
import { withConnection } from "./connection";
import { showErrorToast } from "./errors";

/**
 * Every fire-and-forget action the remote supports, keyed by a stable id.
 * The per-key commands, the Ask command, the menu bar, the visual remote and
 * the AI tool all dispatch through this table, so adding an action here is
 * the whole job of adding it everywhere.
 */
export type ActionId =
  | `${RemoteKey}`
  | "context_menu"
  | "app_switcher"
  | "control_center"
  | "screensaver"
  | "sleep"
  | "wake";

export interface DeviceAction {
  run: (conn: AppleTVConnection) => Promise<void>;
  /** HUD shown after the action succeeds. */
  hud: string;
  /** Spoken/typed synonyms (the id itself, with spaces or hyphens for underscores, is always accepted). */
  phrases?: string[];
}

/** Actions that change power state. They ask for confirmation in the AI power tool, so the remote-key tool refuses them. */
export const POWER_ACTIONS: ReadonlySet<ActionId> = new Set<ActionId>(["sleep", "wake"]);
export type RemoteActionId = Exclude<ActionId, "sleep" | "wake">;

const pressKey = (k: RemoteKey, hud: string, phrases?: string[]): DeviceAction => ({
  run: (conn) => sendKey(conn, k),
  hud,
  phrases,
});

export const ACTIONS: Record<ActionId, DeviceAction> = {
  up: pressKey(RemoteKey.Up, "⬆️ Up"),
  down: pressKey(RemoteKey.Down, "⬇️ Down"),
  left: pressKey(RemoteKey.Left, "⬅️ Left"),
  right: pressKey(RemoteKey.Right, "➡️ Right"),
  select: pressKey(RemoteKey.Select, "⏺ Select", ["ok"]),
  menu: pressKey(RemoteKey.Menu, "↩️ Back", ["back"]),
  home: pressKey(RemoteKey.Home, "🏠 Home"),
  play_pause: pressKey(RemoteKey.PlayPause, "⏯ Play/Pause", ["pause", "play", "resume"]),
  next: pressKey(RemoteKey.Next, "⏭ Next", ["skip"]),
  previous: pressKey(RemoteKey.Previous, "⏮ Previous"),
  volume_up: pressKey(RemoteKey.VolumeUp, "🔊 Volume Up", ["louder"]),
  volume_down: pressKey(RemoteKey.VolumeDown, "🔉 Volume Down", ["quieter"]),
  top_menu: pressKey(RemoteKey.TopMenu, "⏫ Top Menu"),
  home_hold: pressKey(RemoteKey.HomeHold, "🏠 Home (hold)"),
  guide: pressKey(RemoteKey.Guide, "📺 Guide"),
  // The library's key-press mapping for the skip keys is incomplete upstream;
  // the MediaControl seconds path works, so it shadows RemoteKey.SkipForward/Backward.
  skip_forward: { run: (conn) => skipBy(conn, 10), hud: "⏩ +10s" },
  skip_backward: { run: (conn) => skipBy(conn, -10), hud: "⏪ -10s", phrases: ["skip back"] },
  context_menu: {
    run: longPressSelect,
    hud: "📋 Context Menu",
    phrases: ["hold select", "long press", "long press select"],
  },
  app_switcher: { run: appSwitcher, hud: "🗂 App Switcher", phrases: ["switcher", "multitask"] },
  control_center: { run: controlCenter, hud: "🎛 Control Center" },
  screensaver: { run: startScreensaver, hud: "🌌 Screensaver" },
  sleep: { run: sleepDevice, hud: "😴 Sleeping", phrases: ["turn off", "off"] },
  wake: { run: wakeDevice, hud: "👋 Waking", phrases: ["wake up", "turn on", "on"] },
};

export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

const normalize = (phrase: string) =>
  phrase
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

/** Resolve a user phrase ("volume up", "app-switcher", "pause") to an action id. */
export function findAction(phrase: string): ActionId | null {
  const wanted = normalize(phrase);
  if (Object.hasOwn(ACTIONS, wanted)) return wanted as ActionId;
  return ACTION_IDS.find((id) => (ACTIONS[id].phrases ?? []).some((p) => normalize(p) === wanted)) ?? null;
}

/** Run an action over a short-lived connection and confirm it in the HUD. */
export async function performAction(id: ActionId): Promise<void> {
  const { run, hud } = ACTIONS[id];
  await withConnection(run);
  await showHUD(hud);
}

/** A complete no-view Raycast command for one action. */
export function actionCommand(id: ActionId): () => Promise<void> {
  return async () => {
    try {
      await performAction(id);
    } catch (error) {
      await showErrorToast(error);
    }
  };
}
