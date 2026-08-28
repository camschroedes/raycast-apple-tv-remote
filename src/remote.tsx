import { useCallback } from "react";
import { Action, ActionPanel, Color, Form, Grid, Icon, Keyboard, Toast, showToast, useNavigation } from "@raycast/api";
import { AppleTVConnection, setText } from "@bharper/atv-js";
import { ACTIONS, ActionId } from "./lib/actions";
import { ConnectionStatus, usePersistentConnection } from "./lib/use-persistent-connection";

/** What a button does: a device action, or open the text-entry form. */
type Target = ActionId | "type-text";

interface Cell {
  target: Target;
  icon: Icon;
  /** Short label for the grid; the bare-key hint is appended from `keys`. */
  title: string;
  /** Bare keys that trigger this cell from the search bar; the first is shown in the title. */
  keys: string;
  tint?: Color;
}

/** 5-column layout mirroring the physical remote; null cells are spacers. */
const CELLS: (Cell | null)[] = [
  // Row 1
  null,
  { target: "context_menu", icon: Icon.BulletPoints, title: "Hold", keys: "v" },
  { target: "up", icon: Icon.ChevronUp, title: "Up", keys: "wk", tint: Color.PrimaryText },
  { target: "app_switcher", icon: Icon.AppWindowGrid2x2, title: "Apps", keys: "x" },
  null,
  // Row 2
  null,
  { target: "left", icon: Icon.ChevronLeft, title: "Left", keys: "ah", tint: Color.PrimaryText },
  { target: "select", icon: Icon.CircleFilled, title: "Select", keys: "fg", tint: Color.Blue },
  { target: "right", icon: Icon.ChevronRight, title: "Right", keys: "dl", tint: Color.PrimaryText },
  null,
  // Row 3
  null,
  { target: "menu", icon: Icon.Undo, title: "Back", keys: "b" },
  { target: "down", icon: Icon.ChevronDown, title: "Down", keys: "sj", tint: Color.PrimaryText },
  { target: "home", icon: Icon.House, title: "Home", keys: "q" },
  null,
  // Row 4
  null,
  { target: "skip_backward", icon: Icon.Rewind, title: "−10s", keys: "," },
  { target: "play_pause", icon: Icon.PlayFilled, title: "Play", keys: " ", tint: Color.Blue },
  { target: "skip_forward", icon: Icon.Forward, title: "+10s", keys: "." },
  null,
  // Row 5
  null,
  { target: "previous", icon: Icon.RewindFilled, title: "Prev", keys: "[" },
  { target: "control_center", icon: Icon.Switch, title: "Control Center", keys: "c" },
  { target: "next", icon: Icon.ForwardFilled, title: "Next", keys: "]" },
  null,
  // Row 6
  null,
  null,
  { target: "type-text", icon: Icon.Keyboard, title: "Type", keys: "t" },
  null,
  null,
];

/** Bare-key bindings: every cell's keys, plus the volume keys, which have no cell. */
const KEY_BINDINGS = new Map<string, Target>([
  ["-", "volume_down"],
  ["=", "volume_up"],
  ["+", "volume_up"],
]);
for (const cell of CELLS) {
  if (cell) for (const ch of cell.keys) KEY_BINDINGS.set(ch, cell.target);
}

const keyHint = (keys: string) => (keys[0] === " " ? "␣" : keys[0].toUpperCase());

/** ⌥-shortcuts available from every cell, regardless of selection. */
const SHORTCUT_SECTIONS: {
  title: string;
  items: { title: string; icon: Icon; key: Keyboard.KeyEquivalent; target: Target }[];
}[] = [
  {
    title: "Navigate (⌥)",
    items: [
      { title: "Up", icon: Icon.ArrowUp, key: "arrowUp", target: "up" },
      { title: "Down", icon: Icon.ArrowDown, key: "arrowDown", target: "down" },
      { title: "Left", icon: Icon.ArrowLeft, key: "arrowLeft", target: "left" },
      { title: "Right", icon: Icon.ArrowRight, key: "arrowRight", target: "right" },
      { title: "Select", icon: Icon.CircleFilled, key: "return", target: "select" },
      { title: "Back", icon: Icon.Undo, key: "backspace", target: "menu" },
    ],
  },
  {
    title: "More (⌥)",
    items: [
      { title: "Play/Pause", icon: Icon.PlayFilled, key: "p", target: "play_pause" },
      { title: "Start Screensaver", icon: Icon.Moon, key: "s", target: "screensaver" },
    ],
  },
];

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Connecting…",
  "not-paired": "Not Paired",
  disconnected: "Disconnected",
};

/**
 * A visual Apple TV remote: a grid laid out like the physical remote,
 * clickable with the mouse, holding ONE live Companion connection so every
 * press is instant. Keyboard layers on top:
 *  - Bare keys via search interception: WASD/HJKL move, F select, Space ⏯.
 *  - ⌥-shortcuts for every action, regardless of selection.
 */
export default function Remote() {
  const { status, deviceName, run, getConnection, reconnect } = usePersistentConnection();
  const { push } = useNavigation();

  const perform = useCallback(
    (target: Target) => {
      if (target === "type-text") push(<TypeTextForm getConnection={getConnection} />);
      else void run(ACTIONS[target].run);
    },
    [push, run, getConnection],
  );

  // Bare-key layer: typed characters are button presses.
  const handleTyped = useCallback(
    (text: string) => {
      for (const ch of text.toLowerCase()) {
        const target = KEY_BINDINGS.get(ch);
        if (target) perform(target);
      }
    },
    [perform],
  );

  const sharedShortcuts = (
    <>
      {SHORTCUT_SECTIONS.map((section) => (
        <ActionPanel.Section key={section.title} title={section.title}>
          {section.items.map((item) => (
            <Action
              key={item.target}
              title={item.title}
              icon={item.icon}
              shortcut={{ modifiers: ["opt"], key: item.key }}
              onAction={() => perform(item.target)}
            />
          ))}
        </ActionPanel.Section>
      ))}
      <ActionPanel.Section>
        <Action
          title="Reconnect"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={reconnect}
        />
      </ActionPanel.Section>
    </>
  );

  return (
    <Grid
      columns={5}
      aspectRatio="4/3"
      inset={Grid.Inset.Small}
      searchBarPlaceholder="Keys: WASD move · F select · Space ⏯ · B back · Q home"
      filtering={false}
      onSearchTextChange={handleTyped}
      searchText=""
    >
      <Grid.Section title={`${deviceName} · ${STATUS_LABELS[status]}`}>
        {CELLS.map((cell, index) =>
          cell ? (
            <Grid.Item
              key={cell.target}
              content={{ source: cell.icon, tintColor: cell.tint ?? Color.SecondaryText }}
              title={`${cell.title} · ${keyHint(cell.keys)}`}
              actions={
                <ActionPanel>
                  <Action title={cell.title} icon={cell.icon} onAction={() => perform(cell.target)} />
                  {sharedShortcuts}
                </ActionPanel>
              }
            />
          ) : (
            <Grid.Item key={`blank-${index}`} content="blank.png" title="" />
          ),
        )}
      </Grid.Section>
    </Grid>
  );
}

function TypeTextForm({ getConnection }: { getConnection: () => Promise<AppleTVConnection | null> }) {
  const { pop } = useNavigation();

  return (
    <Form
      navigationTitle="Type Text on Apple TV"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Send Text"
            icon={Icon.Text}
            onSubmit={async (values: { text: string }) => {
              const conn = await getConnection();
              if (!conn) return;
              try {
                await setText(conn, values.text);
                await showToast({ style: Toast.Style.Success, title: "Text sent" });
                pop();
              } catch {
                await showToast({
                  style: Toast.Style.Failure,
                  title: "Couldn't Send Text",
                  message: "Focus a text field on the Apple TV first (e.g. a search box).",
                });
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text="Sends text into the focused field on the Apple TV. Focus a search box there first." />
      <Form.TextField id="text" title="Text" placeholder="rick and morty" autoFocus />
    </Form>
  );
}
