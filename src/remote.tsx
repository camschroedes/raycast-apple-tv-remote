import { useCallback, useEffect, useRef, useState } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, List, Toast, showToast, useNavigation, Form } from "@raycast/api";
import { AppleTVConnection, RemoteKey, disconnect, onConnectionLost, sendKey, setText } from "@bharper/atv-js";
import { openConnection } from "./lib/connection";
import { NotPairedError, showErrorToast } from "./lib/errors";

type Status = "connecting" | "connected" | "reconnecting" | "disconnected" | "not-paired";

/**
 * The remote view holds ONE live Companion connection for its whole lifetime,
 * so every keypress is instant (no per-press TCP + pair-verify handshake).
 */
export default function Remote() {
  const connRef = useRef<AppleTVConnection | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [deviceName, setDeviceName] = useState<string>("Apple TV");

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
      if (error instanceof NotPairedError) {
        setStatus("not-paired");
      } else {
        setStatus("disconnected");
      }
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

  const press = useCallback(
    async (key: RemoteKey) => {
      const conn = connRef.current;
      if (!conn) {
        // Connection dropped — try once to re-establish, then send.
        await establish();
        const retry = connRef.current;
        if (!retry) return;
        await sendKey(retry, key).catch(showErrorToast);
        return;
      }
      try {
        await sendKey(conn, key);
      } catch (error) {
        await showErrorToast(error);
      }
    },
    [establish],
  );

  const statusAccessory: List.Item.Accessory =
    status === "connected"
      ? { tag: { value: "Connected", color: Color.Green } }
      : status === "connecting" || status === "reconnecting"
        ? { tag: { value: "Connecting…", color: Color.Yellow } }
        : { tag: { value: "Disconnected", color: Color.Red } };

  // One shared ActionPanel so every shortcut works regardless of selection.
  const actions = (
    <ActionPanel>
      <ActionPanel.Section title="Playback">
        <Action title="Play/Pause" icon={Icon.PlayFilled} onAction={() => press(RemoteKey.PlayPause)} />
        <Action
          title="Next"
          icon={Icon.Forward}
          shortcut={{ modifiers: ["cmd"], key: "]" }}
          onAction={() => press(RemoteKey.Next)}
        />
        <Action
          title="Previous"
          icon={Icon.Rewind}
          shortcut={{ modifiers: ["cmd"], key: "[" }}
          onAction={() => press(RemoteKey.Previous)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="Navigate">
        <Action
          title="Up"
          icon={Icon.ArrowUp}
          shortcut={{ modifiers: ["cmd"], key: "arrowUp" }}
          onAction={() => press(RemoteKey.Up)}
        />
        <Action
          title="Down"
          icon={Icon.ArrowDown}
          shortcut={{ modifiers: ["cmd"], key: "arrowDown" }}
          onAction={() => press(RemoteKey.Down)}
        />
        <Action
          title="Left"
          icon={Icon.ArrowLeft}
          shortcut={{ modifiers: ["cmd"], key: "arrowLeft" }}
          onAction={() => press(RemoteKey.Left)}
        />
        <Action
          title="Right"
          icon={Icon.ArrowRight}
          shortcut={{ modifiers: ["cmd"], key: "arrowRight" }}
          onAction={() => press(RemoteKey.Right)}
        />
        <Action
          title="Select"
          icon={Icon.CircleFilled}
          shortcut={{ modifiers: ["cmd"], key: "return" }}
          onAction={() => press(RemoteKey.Select)}
        />
        <Action
          title="Back (Menu)"
          icon={Icon.ArrowUturnLeft}
          shortcut={{ modifiers: ["cmd"], key: "backspace" }}
          onAction={() => press(RemoteKey.Menu)}
        />
        <Action
          title="Home"
          icon={Icon.House}
          shortcut={{ modifiers: ["cmd"], key: "h" }}
          onAction={() => press(RemoteKey.Home)}
        />
        <Action
          title="App Switcher"
          icon={Icon.AppWindowGrid2x2}
          shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
          onAction={() => press(RemoteKey.HomeHold)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="Volume">
        <Action
          title="Volume up"
          icon={Icon.SpeakerUp}
          shortcut={{ modifiers: ["cmd"], key: "=" }}
          onAction={() => press(RemoteKey.VolumeUp)}
        />
        <Action
          title="Volume Down"
          icon={Icon.SpeakerDown}
          shortcut={{ modifiers: ["cmd"], key: "-" }}
          onAction={() => press(RemoteKey.VolumeDown)}
        />
      </ActionPanel.Section>
      <ActionPanel.Section title="More">
        <TypeTextAction connRef={connRef} />
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
    { title: "D-Pad", subtitle: "⌘↑ ⌘↓ ⌘← ⌘→ move · ⌘↩ select · ⌘⌫ back", icon: Icon.Compass },
    { title: "Playback", subtitle: "↩ play/pause · ⌘] next · ⌘[ previous", icon: Icon.Play },
    { title: "Volume", subtitle: "⌘= up · ⌘- down", icon: Icon.Speaker },
    { title: "Home", subtitle: "⌘H home · ⌘⇧H app switcher", icon: Icon.House },
    { title: "Type Text", subtitle: "⌘T — fill a search field on the TV", icon: Icon.Keyboard },
  ];

  return (
    <List navigationTitle={`Remote — ${deviceName}`} searchBarPlaceholder="Apple TV Remote" filtering={false}>
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

function TypeTextAction({ connRef }: { connRef: React.MutableRefObject<AppleTVConnection | null> }) {
  const { push, pop } = useNavigation();

  return (
    <Action
      title="Type Text on TV"
      icon={Icon.Keyboard}
      shortcut={{ modifiers: ["cmd"], key: "t" }}
      onAction={() =>
        push(
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
          </Form>,
        )
      }
    />
  );
}
