import { Action, ActionPanel, Grid, Icon, LaunchType, Toast, popToRoot, showHUD, showToast } from "@raycast/api";
import { createDeeplink } from "@raycast/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { KNOWN_APPS, loadCachedApps, refreshInstalledApps } from "./lib/apps";
import { launchApp } from "./lib/companion-extras";
import { withConnection } from "./lib/connection";
import { NotPairedError, UnreachableError, showErrorToast } from "./lib/errors";

interface AppEntry {
  bundleId: string;
  name: string;
}

function recordToEntries(apps: Record<string, string>): AppEntry[] {
  return Object.entries(apps)
    .map(([bundleId, name]) => ({ bundleId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FALLBACK_APPS: AppEntry[] = KNOWN_APPS.map((app) => ({ bundleId: app.bundleId, name: app.name })).sort((a, b) =>
  a.name.localeCompare(b.name),
);

export default function LaunchAppCommand() {
  // Seed instantly from cache so the grid renders without waiting on the device.
  const cachedEntries = useMemo(() => {
    const cached = loadCachedApps();
    return cached ? recordToEntries(cached) : undefined;
  }, []);
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const erroredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const live = await withConnection(refreshInstalledApps);
        if (cancelled) return;
        setApps(recordToEntries(live));
      } catch (error) {
        if (cancelled) return;
        // Fall back to the known-app list and surface the failure exactly once.
        setApps((prev) => prev ?? FALLBACK_APPS);
        if (!erroredRef.current) {
          erroredRef.current = true;
          if (error instanceof NotPairedError || error instanceof UnreachableError) {
            await showErrorToast(error);
          } else {
            await showToast({
              style: Toast.Style.Failure,
              title: "Couldn't Load App List",
              message: `${error instanceof Error ? error.message : String(error)}. Showing well-known apps instead.`,
            });
          }
        }
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  async function open(entry: AppEntry) {
    try {
      await withConnection((conn) => launchApp(conn, entry.bundleId));
      await showHUD(`Opened ${entry.name}`);
      await popToRoot();
    } catch (error) {
      await showErrorToast(error);
    }
  }

  // Prefer live results, then cached, then the static fallback.
  const items = apps ?? cachedEntries ?? FALLBACK_APPS;
  const isLoading = isRefreshing && apps === null;

  return (
    <Grid isLoading={isLoading} searchBarPlaceholder="Search Apple TV apps...">
      <Grid.EmptyView
        icon={Icon.AppWindow}
        title="No matching apps"
        description="Try a different search, or open an app by its bundle ID."
      />
      {items.map((entry) => (
        <Grid.Item
          key={entry.bundleId}
          content={Icon.AppWindow}
          title={entry.name}
          subtitle={entry.bundleId}
          actions={
            <ActionPanel>
              <Action title="Open on Apple TV" icon={Icon.Monitor} onAction={() => open(entry)} />
              {/* Saved quicklinks accept their own global hotkey/alias, one keystroke to any app. */}
              <Action.CreateQuicklink
                title="Save as Quicklink (Hotkey-Able)"
                quicklink={{
                  name: `Open ${entry.name} on Apple TV`,
                  link: createDeeplink({
                    command: "ask",
                    launchType: LaunchType.Background,
                    arguments: { query: `open ${entry.name.toLowerCase()}` },
                  }),
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </Grid>
  );
}
