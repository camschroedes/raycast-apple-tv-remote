import { useCallback, useEffect, useRef, useState } from "react";
import { Action, ActionPanel, Color, Form, Icon, Keyboard, List, Toast, showToast, useNavigation } from "@raycast/api";
import { AppleTVConnection, RemoteKey, disconnect, onConnectionLost, sendKey, setText } from "@bharper/atv-js";
import { openConnection } from "./lib/connection";
import { NotPairedError, showErrorToast } from "./lib/errors";
import { appSwitcher, controlCenter, longPressSelect, skipBy, startScreensaver } from "./lib/companion-extras";

type Status = "connecting" | "connected" | "reconnecting" | "disconnected" | "not-paired";

/**
 * The remote view holds ONE live Companion connection for its whole lifetime,
 * so every keypress is instant. Two input layers:
 *  - Bare keys, no modifiers: the search bar (filtering off) intercepts typed
 *    characters — WASD/HJKL navigate, F selects, Space toggles playback.
 *  - ⌥-shortcuts for everything, usable regardless of focus.
 */
export default function Remote() {
  const connRef = useRef<AppleTVConnection | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [deviceName, setDeviceName] = useState<string>("Apple TV");
  const { push } = useNavigation();

  const establish = useCallback(async () => {
    setStatus((s) => (s === "connected" ? "reconnecting" : "connecting"));
    try {
      const conn = await openConnection();
      connRef.current = conn;
      setDeviceName(conn.device.name);
      setStatus("connected");
      onConnectionLost(conn, () => {
        connRef.current = null;
        setStatus("disconnected");
      });
    } catch (error) {
      connRef.current = null;
      setStatus(error instanceof NotPairedError ? "not-paired" : "disconnected");
      await showErrorToast(error);
    }
  }, []);

  useEffect(() => {
    establish();
    return () => {
      if (connRef.current) {
        disconnect(connRef.current);
        connRef.current = null;
      }
    };
  }, [establish]);

  const run = useCallback(
    async (action: (conn: AppleTVConnection) => Promise<void>) => {
      let conn = connRef.current;
      if (!conn) {
        await establish();
        conn = connRef.current;
        if (!conn) return;
      }
      try {
        await action(conn);
      } catch (error) {
        await showErrorToast(error);
      }
    },
    [establish],
  );

  const press = useCallback((key: RemoteKey) => run((conn) => sendKey(conn, key)), [run]);

  const pushTypeText = useCallback(() => {
    push(<TypeTextForm connRef={connRef} />);
  }, [push]);

  // Bare-key layer: every typed character is a button press. The search bar is
  // the only surface Raycast lets us read unmodified keystrokes from.
  const handleTyped = useCallback(
    (text: string) => {
      if (!text) return;
      for (const ch of text.toLowerCase()) {
        switch (ch) {
          case "w":
          case "k":
            void press(RemoteKey.Up);
            break;
          case "s":
          case "j":
            void press(RemoteKey.Down);
            break;
          case "a":
          case "h":
            void press(RemoteKey.Left);
            break;
          case "d":
          case "l":
            void press(RemoteKey.Right);
            break;
          case "f":
          case "g":
            void press(RemoteKey.Select);
            break;
          case " ":
            void press(RemoteKey.PlayPause);
            break;
          case "b":
            void press(RemoteKey.Menu);
            break;
          case "q":
            void press(RemoteKey.Home);
            break;
          case "v":
            void run(longPressSelect);
            break;
          case "x":
            void run(appSwitcher);
            break;
          case "c":
            void run(controlCenter);
            break;
          case "[":
            void press(RemoteKey.Previous);
            break;
          case "]":
            void press(RemoteKey.Next);
            break;
          case ",":
            void run((conn) => skipBy(conn, -10));
            break;
          case ".":
            void run((conn) => skipBy(conn, 10));
            break;
          case "-":
            void press(RemoteKey.VolumeDown);
            break;
          case "=":
          case "+":
            void press(RemoteKey.VolumeUp);
            break;
          case "t":
            pushTypeText();
            break;
        }
      }
    },
    [press, run, pushTypeText],
  );

  const statusAccessory: List.Item.Accessory =
    status === "connected"
      ? { tag: { value: "Connected", color: Color.Green } }
      : status === "connecting" || status === "reconnecting"
        ? { tag: { value: "Connecting…", color: Color.Yellow } }
        : { tag: { value: "Disconnected", color: Color.Red } };

  // One shared ActionPanel so every ⌥-shortcut works regardless of selection.
  const actions = (
    <ActionPanel>
      <ActionPanel.Section title="Navigate">
        <Action title="Select" icon={Icon.CircleFilled} onAction={() => press(RemoteKey.Select)} />
        <Action
          title="Up"
          icon={Icon.ArrowUp}
          shortcut={{ modifiers: ["opt"], key: "arrowUp" }}
          onAction={() => press(RemoteKey.Up)}
        />
        <Action
          title="Down"
          icon={Icon.ArrowDown}
          shortcut={{ modifiers: ["opt"], key: "arrowDown" }}
          onAction={() => press(RemoteKey.Down)}
        />
        <Action
          title="Left"
          icon={Icon.ArrowLeft}
          shortcut={{ modifiers: ["opt"], key: "arrowLeft" }}
          onAction={() => press(RemoteKey.Left)}
        />
        <Action
          title="Right"
          icon={Icon.ArrowRight}
          shortcut={{ modifiers: ["opt"], key: "arrowRight" }}
          onAction={() => press(RemoteKey.Right)}
        />
        <Action
          title="Back"
          icon={Icon.ArrowUturnLeft}
          shortcut={{ modifiers: ["opt"], key: "backspace" }}
          onAction={() => press(RemoteKey.Menu)}
        />
        <Action
          title="Home"
          icon={Icon.House}
          shortcut={{ modifiers: ["opt"], key: "q" }}
          onAction={() => press(RemoteKey.Home)}
        />
        <Action
          title="Context Menu (Hold Select)"
          icon={Icon.BulletPoints}
          shortcut={{ modifiers: ["opt"], key: "v" }}
          onAction={() => run(longPressSelect)}
        />
        <Action
          title="App Switcher"
          icon={Icon.AppWindowGrid2x2}
          shortcut={{ modifiers: ["opt"], key: "x" }}
          onAction={() => run(appSwitcher)}
        />
        <Action
          title="Control Center"
          icon={Icon.Switch}
          shortcut={{ modifiers: ["opt"], key: "c" }}
          onAction={() => run(controlCenter)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="Playback">
        <Action
          title="Play/Pause"
          icon={Icon.PlayFilled}
          shortcut={{ modifiers: ["opt"], key: "p" }}
          onAction={() => press(RemoteKey.PlayPause)}
        />
        <Action
          title="Skip Forward 10S"
          icon={Icon.Forward}
          shortcut={{ modifiers: ["opt"], key: "." }}
          onAction={() => run((conn) => skipBy(conn, 10))}
        />
        <Action
          title="Skip Back 10S"
          icon={Icon.Rewind}
          shortcut={{ modifiers: ["opt"], key: "," }}
          onAction={() => run((conn) => skipBy(conn, -10))}
        />
        <Action
          title="Next"
          icon={Icon.ForwardFilled}
          shortcut={{ modifiers: ["opt"], key: "]" }}
          onAction={() => press(RemoteKey.Next)}
        />
        <Action
          title="Previous"
          icon={Icon.RewindFilled}
          shortcut={{ modifiers: ["opt"], key: "[" }}
          onAction={() => press(RemoteKey.Previous)}
        />
        <Action
          title="Volume up"
          icon={Icon.SpeakerUp}
          shortcut={{ modifiers: ["opt"], key: "=" }}
          onAction={() => press(RemoteKey.VolumeUp)}
        />
        <Action
          title="Volume Down"
          icon={Icon.SpeakerDown}
          shortcut={{ modifiers: ["opt"], key: "-" }}
          onAction={() => press(RemoteKey.VolumeDown)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="More">
        <Action
          title="Type Text on TV"
          icon={Icon.Keyboard}
          shortcut={{ modifiers: ["opt"], key: "t" }}
          onAction={pushTypeText}
        />
        <Action
          title="Start Screensaver"
          icon={Icon.Moon}
          shortcut={{ modifiers: ["opt"], key: "s" }}
          onAction={() => run(startScreensaver)}
        />
        <Action
          title="Reconnect"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={establish}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );

  const rows: { title: string; subtitle: string; icon: Icon }[] = [
    { title: "Navigate", subtitle: "W A S D (or H J K L) move · F select · B back · Q home", icon: Icon.Compass },
    { title: "Playback", subtitle: "Space play/pause · , . skip ±10s · [ ] prev/next", icon: Icon.Play },
    { title: "Volume", subtitle: "− softer · = louder", icon: Icon.Speaker },
    { title: "System", subtitle: "V hold-select menu · X app switcher · C control center", icon: Icon.Cog },
    { title: "Type Text", subtitle: "T — fill a search field on the TV", icon: Icon.Keyboard },
  ];

  return (
    <List
      navigationTitle={`Remote — ${deviceName}`}
      searchBarPlaceholder="Press keys: WASD move · F select · Space play · B back"
      filtering={false}
      searchText=""
      onSearchTextChange={handleTyped}
    >
      {rows.map((row, index) => (
        <List.Item
          key={row.title}
          icon={row.icon}
          title={row.title}
          subtitle={row.subtitle}
          accessories={index === 0 ? [statusAccessory] : undefined}
          actions={actions}
        />
      ))}
    </List>
  );
}

function TypeTextForm({ connRef }: { connRef: React.MutableRefObject<AppleTVConnection | null> }) {
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
              const conn = connRef.current;
              if (!conn) {
                await showToast({ style: Toast.Style.Failure, title: "Not connected" });
                return;
              }
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
      <Form.Description text="Sends text into the focused field on the Apple TV — focus a search box there first." />
      <Form.TextField id="text" title="Text" placeholder="rick and morty" autoFocus />
    </Form>
  );
}
