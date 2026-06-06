import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { RemoteKey, sendKey } from "@bharper/atv-js";
import { withConnection } from "./lib/connection";
import { showErrorToast } from "./lib/errors";
import { appSwitcher, controlCenter, launchApp, skipBy, sleepDevice, wakeDevice } from "./lib/companion-extras";
import { getSelectedDeviceOrNull } from "./lib/devices";
import { loadCachedApps } from "./lib/deep-links";

/**
 * Menu-bar remote. macOS menus are the only surface Raycast extensions get in
 * the status bar (rows of text+icon; every click closes the menu), so this
 * lays the remote out as rows: d-pad keys first, then playback, apps, power.
 * For continuous navigation the first item opens the visual remote view.
 */

async function runKey(key: RemoteKey): Promise<void> {
  try {
    await withConnection((conn) => sendKey(conn, key));
  } catch (e) {
    await showErrorToast(e);
  }
}

async function run(action: Parameters<typeof withConnection>[0]): Promise<void> {
  try {
    await withConnection(action);
  } catch (e) {
    await showErrorToast(e);
  }
}

export default function Command() {
  const { data: device, isLoading } = usePromise(getSelectedDeviceOrNull);
  const { data: cachedApps } = usePromise(loadCachedApps);

  const topApps = cachedApps ? Object.entries(cachedApps.apps).slice(0, 12) : [];

  return (
    <MenuBarExtra
      icon={Icon.Tv}
      isLoading={isLoading}
      tooltip={device ? `Apple TV: ${device.name}` : "Apple TV Remote"}
    >
      <MenuBarExtra.Item
        title={device ? "Open Full Remote" : "Set up Apple TV"}
        subtitle={device?.name}
        icon={Icon.GameController}
        onAction={() => void launchCommand({ name: device ? "remote" : "setup", type: LaunchType.UserInitiated })}
      />

      <MenuBarExtra.Section title="Navigate">
        <MenuBarExtra.Item title="Up" icon={Icon.ChevronUp} onAction={() => void runKey(RemoteKey.Up)} />
        <MenuBarExtra.Item title="Down" icon={Icon.ChevronDown} onAction={() => void runKey(RemoteKey.Down)} />
        <MenuBarExtra.Item title="Left" icon={Icon.ChevronLeft} onAction={() => void runKey(RemoteKey.Left)} />
        <MenuBarExtra.Item title="Right" icon={Icon.ChevronRight} onAction={() => void runKey(RemoteKey.Right)} />
        <MenuBarExtra.Item
          title="Select"
          icon={Icon.CircleFilled}
          onAction={() => void runKey(RemoteKey.Select)}
          alternate={<MenuBarExtra.Item title="Home" icon={Icon.House} onAction={() => void runKey(RemoteKey.Home)} />}
        />
        <MenuBarExtra.Item
          title="Back"
          icon={Icon.ArrowUturnLeft}
          onAction={() => void runKey(RemoteKey.Menu)}
          alternate={
            <MenuBarExtra.Item
              title="App Switcher"
              icon={Icon.AppWindowGrid2x2}
              onAction={() => void run(appSwitcher)}
            />
          }
        />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Playback">
        <MenuBarExtra.Item
          title="Play/Pause"
          icon={Icon.PlayFilled}
          onAction={() => void runKey(RemoteKey.PlayPause)}
          alternate={
            <MenuBarExtra.Item title="Control Center" icon={Icon.Switch} onAction={() => void run(controlCenter)} />
          }
        />
        <MenuBarExtra.Item
          title="Skip Forward 10s"
          icon={Icon.Forward}
          onAction={() => void run((c) => skipBy(c, 10))}
        />
        <MenuBarExtra.Item title="Skip Back 10s" icon={Icon.Rewind} onAction={() => void run((c) => skipBy(c, -10))} />
        <MenuBarExtra.Item title="Volume Up" icon={Icon.SpeakerUp} onAction={() => void runKey(RemoteKey.VolumeUp)} />
        <MenuBarExtra.Item
          title="Volume Down"
          icon={Icon.SpeakerDown}
          onAction={() => void runKey(RemoteKey.VolumeDown)}
        />
      </MenuBarExtra.Section>

      {topApps.length > 0 && (
        <MenuBarExtra.Section>
          <MenuBarExtra.Submenu title="Open App" icon={Icon.AppWindow}>
            {topApps.map(([bundleId, name]) => (
              <MenuBarExtra.Item key={bundleId} title={name} onAction={() => void run((c) => launchApp(c, bundleId))} />
            ))}
          </MenuBarExtra.Submenu>
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Sleep"
          icon={Icon.Moon}
          onAction={() => void run(sleepDevice)}
          alternate={<MenuBarExtra.Item title="Wake" icon={Icon.Sun} onAction={() => void run(wakeDevice)} />}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
