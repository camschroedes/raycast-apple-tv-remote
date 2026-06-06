import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { RemoteKey, sendKey } from "@bharper/atv-js";
import { withConnection } from "./lib/connection";
import { showErrorToast } from "./lib/errors";
import { sleepDevice, wakeDevice } from "./lib/companion-extras";
import { getSelectedDeviceOrNull } from "./lib/devices";

async function runKey(key: RemoteKey): Promise<void> {
  try {
    await withConnection((conn) => sendKey(conn, key));
  } catch (e) {
    await showErrorToast(e);
  }
}

async function runSleep(): Promise<void> {
  try {
    await withConnection((conn) => sleepDevice(conn));
  } catch (e) {
    await showErrorToast(e);
  }
}

async function runWake(): Promise<void> {
  try {
    await withConnection((conn) => wakeDevice(conn));
  } catch (e) {
    await showErrorToast(e);
  }
}

export default function Command() {
  const { data: device, isLoading } = usePromise(getSelectedDeviceOrNull);

  return (
    <MenuBarExtra icon={Icon.Tv} isLoading={isLoading}>
      <MenuBarExtra.Item title={device ? `Apple TV: ${device.name}` : "No Apple TV set up"} />

      <MenuBarExtra.Section title="Playback">
        <MenuBarExtra.Item title="Play/Pause ⏯" onAction={() => void runKey(RemoteKey.PlayPause)} />
        <MenuBarExtra.Item title="Next" onAction={() => void runKey(RemoteKey.Next)} />
        <MenuBarExtra.Item title="Previous" onAction={() => void runKey(RemoteKey.Previous)} />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Navigate">
        <MenuBarExtra.Item title="Up" onAction={() => void runKey(RemoteKey.Up)} />
        <MenuBarExtra.Item title="Down" onAction={() => void runKey(RemoteKey.Down)} />
        <MenuBarExtra.Item title="Left" onAction={() => void runKey(RemoteKey.Left)} />
        <MenuBarExtra.Item title="Right" onAction={() => void runKey(RemoteKey.Right)} />
        <MenuBarExtra.Item title="Select" onAction={() => void runKey(RemoteKey.Select)} />
        <MenuBarExtra.Item title="Menu" onAction={() => void runKey(RemoteKey.Menu)} />
        <MenuBarExtra.Item title="Home" onAction={() => void runKey(RemoteKey.Home)} />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Power">
        <MenuBarExtra.Item title="Sleep" onAction={() => void runSleep()} />
        <MenuBarExtra.Item title="Wake" onAction={() => void runWake()} />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Set Up Apple TV"
          icon={Icon.Gear}
          onAction={() => void launchCommand({ name: "setup", type: LaunchType.UserInitiated })}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
