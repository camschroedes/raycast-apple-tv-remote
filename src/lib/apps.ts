import { Cache } from "@raycast/api";
import { AppleTVConnection } from "@bharper/atv-js";
import { launchApp, listApps } from "./companion-extras";
import { withConnection } from "./connection";

/**
 * Everything we know about a tvOS streaming app: how users refer to it, how
 * to launch it, which JustWatch providers stream through it, and whether the
 * provider's web URLs actually deep-link on tvOS.
 */
export interface KnownApp {
  name: string;
  bundleId: string;
  aliases: string[];
  /** JustWatch provider technical names that play inside this app. */
  providers?: string[];
  /** False when the provider's web URLs don't deep-link on tvOS (route via universal search instead). */
  deepLinks?: boolean;
  /** Per-app URL fixups for tvOS routing quirks. */
  adaptUrl?: (url: string) => string;
}

export const KNOWN_APPS: KnownApp[] = [
  {
    name: "Netflix",
    bundleId: "com.netflix.Netflix",
    aliases: ["netflix"],
    providers: ["netflix", "netflixbasicwithads"],
    // Netflix's tvOS deep links broke in Sept 2025.
    deepLinks: false,
  },
  {
    name: "Disney+",
    bundleId: "com.disney.disneyplus",
    aliases: ["disney", "disney+", "disney plus", "disneyplus"],
    providers: ["disneyplus"],
  },
  {
    name: "Max",
    bundleId: "com.wbd.stream",
    aliases: ["max", "hbo", "hbo max"],
    providers: ["max", "hbomax"],
  },
  {
    name: "Apple TV",
    bundleId: "com.apple.TVWatchList",
    aliases: ["apple tv", "apple tv+", "tv app", "apple tv plus"],
    providers: ["appletvplus", "itunes"],
    adaptUrl: (url) => (url.includes("?") ? `${url}&action=play` : `${url}?action=play`),
  },
  {
    name: "YouTube",
    bundleId: "com.google.ios.youtube",
    aliases: ["youtube", "yt"],
    providers: ["youtube"],
    // The scheme form routes reliably on tvOS; plain https is flaky.
    adaptUrl: (url) => {
      const id = url.match(/[?&]v=([\w-]+)/)?.[1];
      return id ? `youtube://www.youtube.com/watch?v=${id}` : url;
    },
  },
  {
    name: "Hulu",
    bundleId: "com.hulu.plus",
    aliases: ["hulu"],
    providers: ["hulu"],
  },
  {
    name: "Prime Video",
    bundleId: "com.amazon.aiv.AIVApp",
    aliases: ["prime", "prime video", "amazon", "amazon prime"],
    providers: ["amazonprimevideo", "amazonprime"],
  },
  {
    name: "Spotify",
    bundleId: "com.spotify.client",
    aliases: ["spotify"],
  },
  {
    name: "Plex",
    bundleId: "com.plexapp.plex",
    aliases: ["plex"],
  },
  {
    name: "Settings",
    bundleId: "com.apple.TVSettings",
    aliases: ["settings"],
  },
];

export interface ResolvedApp {
  bundleId: string;
  name: string;
}

/** The known app that plays a JustWatch provider's content, if we have one. */
export function appForProvider(technicalName: string): KnownApp | undefined {
  return KNOWN_APPS.find((app) => app.providers?.includes(technicalName));
}

/** Match a user-supplied app name against the known apps and an installed-app list. */
export function resolveAppName(query: string, installed: Record<string, string> = {}): ResolvedApp | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const known = ({ bundleId, name }: KnownApp): ResolvedApp => ({ bundleId, name });

  // Exact/alias match against the curated map first (handles "hbo" → Max etc.)
  for (const app of KNOWN_APPS) {
    if (app.name.toLowerCase() === q || app.aliases.includes(q)) return known(app);
  }

  // Then against what's actually installed on the device, exact first.
  for (const [bundleId, name] of Object.entries(installed)) {
    if (name.toLowerCase() === q) return { bundleId, name };
  }

  // Substring only for queries long enough to mean something: a two-letter
  // query matches half a real app list, and launching the wrong app is worse
  // than not finding one.
  if (q.length >= 3) {
    for (const [bundleId, name] of Object.entries(installed)) {
      if (name.toLowerCase().includes(q)) return { bundleId, name };
    }
  }

  // Finally substring match the curated map, with the same length floor.
  if (q.length >= 3) {
    for (const app of KNOWN_APPS) {
      if (app.name.toLowerCase().includes(q) || app.aliases.some((a) => a.includes(q))) return known(app);
    }
  }

  return null;
}

// The app list is disposable derived data, so it belongs in Cache (on-disk,
// synchronous, evictable) rather than LocalStorage, which is the encrypted
// database and is not meant for payloads of this size.
const cache = new Cache();
const APP_CACHE_KEY = "atv:apps";

/** Installed apps (bundle ID → display name) as of the last device fetch. */
export function loadCachedApps(): Record<string, string> | null {
  const raw = cache.get(APP_CACHE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, string>) : null;
}

/** Fetch the installed apps from the device and refresh the cache. */
export async function refreshInstalledApps(conn: AppleTVConnection): Promise<Record<string, string>> {
  const apps = await listApps(conn);
  cache.set(APP_CACHE_KEY, JSON.stringify(apps));
  return apps;
}

/**
 * Resolve a spoken app name and launch it. Known apps and the cached
 * installed list resolve without a round trip; unknown names fall back to the
 * device's live app list over the same connection used to launch.
 */
export async function launchAppByName(query: string): Promise<ResolvedApp | null> {
  let resolved = resolveAppName(query, loadCachedApps() ?? {});
  return withConnection(async (conn) => {
    if (!resolved) {
      // The connection is live at this point, so a failure here is the app
      // list itself (tvOS 26.5 never answers it): the app is simply unknown.
      const installed = await refreshInstalledApps(conn).catch(() => ({}));
      resolved = resolveAppName(query, installed);
    }
    if (resolved) await launchApp(conn, resolved.bundleId);
    return resolved;
  });
}
