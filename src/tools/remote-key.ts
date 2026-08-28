import { ACTIONS, ACTION_IDS, POWER_ACTIONS, RemoteActionId, findAction } from "../lib/actions";
import { withConnection } from "../lib/connection";

type Input = {
  /**
   * The remote action to perform. Spelled out rather than derived, because
   * Raycast's tool-schema generator only turns a literal union into an enum
   * for the model. The assertion below fails the build if it drifts from the
   * action registry. Sleep and wake are absent on purpose: they belong to the
   * power tool, which asks for confirmation first.
   */
  key:
    | "up"
    | "down"
    | "left"
    | "right"
    | "select"
    | "menu"
    | "home"
    | "top_menu"
    | "home_hold"
    | "guide"
    | "play_pause"
    | "next"
    | "previous"
    | "volume_up"
    | "volume_down"
    | "skip_forward"
    | "skip_backward"
    | "context_menu"
    | "app_switcher"
    | "control_center"
    | "screensaver";
};

type Assert<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type KeysMatchRegistry = Assert<
  RemoteActionId extends Input["key"] ? (Input["key"] extends RemoteActionId ? true : never) : never
>;

/**
 * Press a single button on the Apple TV remote (navigation, playback, volume),
 * or perform a remote gesture: context_menu (long-press select), app_switcher,
 * control_center, screensaver, skip_forward/skip_backward.
 */
export default async function tool(input: Input): Promise<string> {
  const id = findAction(input.key);
  if (!id || POWER_ACTIONS.has(id)) {
    const valid = ACTION_IDS.filter((k) => !POWER_ACTIONS.has(k));
    return `Invalid key "${input.key}". Valid: ${valid.join(", ")}.`;
  }

  const label = id.replace(/_/g, " ");
  try {
    await withConnection(ACTIONS[id].run);
    return `Pressed ${label}`;
  } catch (error) {
    return `Failed to press ${label}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
