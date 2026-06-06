import { OAuthService } from "@raycast/utils";
import { getPreferenceValues } from "@raycast/api";
import { withConnection } from "./connection";
import { launchApp } from "./companion-extras";
import { getSelectedDeviceOrNull } from "./devices";

/**
 * Spotify Connect: the Apple TV's Spotify app is a Connect device, so music
 * playback is fully API-driven and VERIFIED — no remote keys, no navigation.
 * Flow: OAuth (Raycast PKCE proxy) → fuzzy-match the playlist in the user's
 * library → make the TV visible by launching the Spotify app via Companion →
 * transfer playback → play → confirm via /me/player. Requires Spotify Premium.
 */

const SPOTIFY_BUNDLE = "com.spotify.client";
const API = "https://api.spotify.com/v1";
const SCOPES = "user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative";

export class SpotifyNotConfiguredError extends Error {
  constructor() {
    super(
      "Spotify isn't set up yet. Create a free app at developer.spotify.com/dashboard, " +
        "add the Raycast redirect URI, and paste its Client ID into this extension's preferences.",
    );
    this.name = "SpotifyNotConfiguredError";
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function oauthClient() {
  const { spotifyClientId } = getPreferenceValues<{ spotifyClientId?: string }>();
  const clientId = spotifyClientId?.trim();
  if (!clientId) throw new SpotifyNotConfiguredError();
  return OAuthService.spotify({ clientId, scope: SCOPES });
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Spotify API ${response.status}: ${body.slice(0, 200)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Playlist {
  name: string;
  uri: string;
}

/**
 * Find a playlist in the user's library. The search API misses private
 * playlists, so we paginate the library and match locally — normalization
 * makes "hype" find "H Y P E".
 */
async function findPlaylist(token: string, query: string): Promise<Playlist | null> {
  const want = normalize(query);
  if (!want) return null;

  const all: Playlist[] = [];
  let url: string | null = "/me/playlists?limit=50";
  while (url) {
    const page = await api<{ items: { name: string; uri: string }[]; next: string | null }>(token, url);
    if (!page) break;
    all.push(...page.items.map((p) => ({ name: p.name, uri: p.uri })));
    url = page.next ? page.next.replace(API, "") : null;
  }

  return (
    all.find((p) => normalize(p.name) === want) ??
    all.find((p) => normalize(p.name).includes(want)) ??
    all.find((p) => want.includes(normalize(p.name)) && normalize(p.name).length > 2) ??
    null
  );
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

async function findTvDevice(token: string): Promise<SpotifyDevice | null> {
  const result = await api<{ devices: SpotifyDevice[] }>(token, "/me/player/devices");
  const devices = result?.devices ?? [];
  const atvName = (await getSelectedDeviceOrNull())?.name;

  return (
    (atvName && devices.find((d) => d.name.toLowerCase() === atvName.toLowerCase())) ||
    devices.find((d) => /tv/i.test(d.type)) ||
    devices.find((d) => /apple\s?tv/i.test(d.name)) ||
    null
  );
}

export interface MusicResult {
  ok: boolean;
  message: string;
}

export async function playPlaylistOnTV(query: string): Promise<MusicResult> {
  const token = await oauthClient().authorize();

  const playlist = await findPlaylist(token, query);
  if (!playlist) {
    return { ok: false, message: `No playlist matching “${query}” in your Spotify library.` };
  }

  // The TV is invisible to Spotify Connect unless its Spotify app is
  // foregrounded — launch it via Companion first, then poll.
  let device = await findTvDevice(token);
  if (!device) {
    try {
      await withConnection((conn) => launchApp(conn, SPOTIFY_BUNDLE));
    } catch {
      // TV unreachable — the poll below will surface it
    }
    for (let attempt = 0; attempt < 10 && !device; attempt++) {
      await delay(1500);
      device = await findTvDevice(token);
    }
  }
  if (!device) {
    return {
      ok: false,
      message: "The Apple TV isn't showing up in Spotify Connect. Is the TV awake and the Spotify app installed?",
    };
  }

  // Activate the device first (first-call playback on inactive devices is
  // flaky), then start the playlist targeting it explicitly. Retry — 404/502
  // are documented transient failures here.
  if (!device.is_active) {
    await api(token, "/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [device.id], play: false }),
    }).catch(() => {});
    await delay(1000);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await api(token, `/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
        method: "PUT",
        body: JSON.stringify({ context_uri: playlist.uri }),
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if ((error as { status?: number }).status === 403) {
        return { ok: false, message: "Spotify says no — playback control needs Spotify Premium." };
      }
      await delay(1200);
    }
  }
  if (lastError) {
    return { ok: false, message: `Spotify wouldn't start playback: ${(lastError as Error).message}` };
  }

  // Close the loop: confirm it's actually playing the right thing.
  await delay(1500);
  const state = await api<{ is_playing: boolean; context?: { uri: string }; device?: { id: string } }>(
    token,
    "/me/player",
  );
  const verified = !!state?.is_playing && state.context?.uri === playlist.uri;
  return {
    ok: true,
    message: verified
      ? `▶️ Playing “${playlist.name}” on ${device.name} — confirmed.`
      : `Sent “${playlist.name}” to ${device.name}. Spotify hasn't confirmed playback yet — give it a second.`,
  };
}
