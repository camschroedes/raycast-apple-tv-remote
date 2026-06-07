import { Icon, LaunchType, MenuBarExtra, launchCommand } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getSelectedDeviceOrNull } from "./lib/devices";
import { loadCachedApps } from "./lib/deep-links";
import { getNowPlayingSnapshot, type NowPlaying } from "./lib/nowplaying";

/**
 * Menu-bar remote with live Now Playing. The menu-bar title shows what's
 * currently playing (title/app + state) by opening a short-lived
 * MRP-over-AirPlay tunnel each refresh — Companion alone can't see playback.
 *
 * Clicking an item closes the menu and Raycast unloads this command, which
 * would kill an in-flight Companion handshake — so navigation actions are
 * delegated to a background launch of the `ask` command.
 */

const fire = (query: string) => () =>
  void launchCommand({ name: "ask", type: LaunchType.Background, arguments: { query } }).catch(() => {});

function fmtTime(seconds?: number): string | undefined {
  if (seconds == null) return undefined;
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function truncate(s: string, n = 32): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** The short string shown directly in the menu bar (undefined = icon only). */
function menuBarTitle(np: NowPlaying | null | undefined): string | undefined {
  if (!np) return undefined;
  const label = np.title ?? np.appName;
  if (!label) return undefined;
  if (np.playbackState === "playing") return truncate(`▶ ${label}`);
  if (np.playbackState === "paused") return truncate(`⏸ ${label}`);
  return undefined; // idle / unknown → icon only, no clutter
}

export default function Command() {
  const { data: device, isLoading: deviceLoading } = usePromise(getSelectedDeviceOrNull);
  const { data: cachedApps } = usePromise(loadCachedApps);
  const { data: np, isLoading: npLoading } = usePromise(
    (dev: typeof device): Promise<NowPlaying | null> =>
      dev ? getNowPlayingSnapshot(dev).catch(() => null) : Promise.resolve(null),
    [device],
  );

  const topApps = cachedApps ? Object.entries(cachedApps.apps).slice(0, 12) : [];
  const paired = np !== null && np !== undefined; // null = AirPlay not paired
  const elapsed = fmtTime(np?.elapsed);
  const duration = fmtTime(np?.duration);
  const position = elapsed ? (duration ? `${elapsed} / ${duration}` : elapsed) : undefined;
  const hasMedia = !!(np && (np.title || np.appName) && np.playbackState !== "idle");

  return (
    <MenuBarExtra
      icon={{ source: { light: "menubar-icon.png", dark: "menubar-icon@dark.png" } }}
      isLoading={deviceLoading || npLoading}
      title={menuBarTitle(np)}
      tooltip={device ? `Apple TV: ${device.name}` : "Apple TV Remote"}
    >
      <MenuBarExtra.Item
        title={device ? "Open Full Remote" : "Set up Apple TV"}
        subtitle={device?.name}
        icon={Icon.GameController}
        onAction={() => void launchCommand({ name: device ? "remote" : "setup", type: LaunchType.UserInitiated })}
      />

      {device && (
        <MenuBarExtra.Section title="Now Playing">
          {!paired ? (
            <MenuBarExtra.Item
              title="Set Up Now Playing…"
              subtitle="One-time AirPlay PIN"
              icon={Icon.Play}
              onAction={() => void launchCommand({ name: "now-playing-setup", type: LaunchType.UserInitiated })}
            />
          ) : hasMedia ? (
            <>
              <MenuBarExtra.Item
                title={truncate(np!.title ?? np!.appName ?? "Playing", 40)}
                subtitle={np!.playbackState === "paused" ? "Paused" : "Playing"}
                icon={np!.playbackState === "paused" ? Icon.Pause : Icon.PlayFilled}
                onAction={fire("pause")}
              />
              {(np!.artist || np!.album) && (
                <MenuBarExtra.Item
                  title={truncate([np!.artist, np!.album].filter(Boolean).join(" — "), 40)}
                  icon={Icon.Music}
                />
              )}
              {position && <MenuBarExtra.Item title={position} icon={Icon.Clock} />}
              {np!.appName && <MenuBarExtra.Item title={`in ${np!.appName}`} icon={Icon.AppWindow} />}
            </>
          ) : (
            <MenuBarExtra.Item
              title={np?.appName ? `${np.appName} — nothing playing` : "Nothing playing"}
              icon={Icon.Pause}
            />
          )}
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section title="Navigate">
        <MenuBarExtra.Item title="Up" icon={Icon.ChevronUp} onAction={fire("up")} />
        <MenuBarExtra.Item title="Down" icon={Icon.ChevronDown} onAction={fire("down")} />
        <MenuBarExtra.Item title="Left" icon={Icon.ChevronLeft} onAction={fire("left")} />
        <MenuBarExtra.Item title="Right" icon={Icon.ChevronRight} onAction={fire("right")} />
        <MenuBarExtra.Item
          title="Select"
          icon={Icon.CircleFilled}
          onAction={fire("select")}
          alternate={<MenuBarExtra.Item title="Home" icon={Icon.House} onAction={fire("home")} />}
        />
        <MenuBarExtra.Item
          title="Back"
          icon={Icon.Undo}
          onAction={fire("back")}
          alternate={
            <MenuBarExtra.Item title="App Switcher" icon={Icon.AppWindowGrid2x2} onAction={fire("app switcher")} />
          }
        />
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Playback">
        <MenuBarExtra.Item
          title="Play/Pause"
          icon={Icon.PlayFilled}
          onAction={fire("pause")}
          alternate={<MenuBarExtra.Item title="Control Center" icon={Icon.Switch} onAction={fire("control center")} />}
        />
        <MenuBarExtra.Item title="Skip Forward 10s" icon={Icon.Forward} onAction={fire("skip forward")} />
        <MenuBarExtra.Item title="Skip Back 10s" icon={Icon.Rewind} onAction={fire("skip back")} />
      </MenuBarExtra.Section>

      {topApps.length > 0 && (
        <MenuBarExtra.Section>
          <MenuBarExtra.Submenu title="Open App" icon={Icon.AppWindow}>
            {topApps.map(([bundleId, name]) => (
              <MenuBarExtra.Item key={bundleId} title={name} onAction={fire(`open ${name.toLowerCase()}`)} />
            ))}
          </MenuBarExtra.Submenu>
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Sleep"
          icon={Icon.Moon}
          onAction={fire("sleep")}
          alternate={<MenuBarExtra.Item title="Wake" icon={Icon.Sun} onAction={fire("wake")} />}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
