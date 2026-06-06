import { SpotifyNotConfiguredError, playPlaylistOnTV } from "../lib/spotify";

type Input = {
  /** Playlist name as the user said it, e.g. "hype" for a playlist called "H Y P E", or "workout mix" */
  query: string;
};

/**
 * Play a playlist from the user's Spotify library on the Apple TV via Spotify
 * Connect — fully verified playback, fuzzy name matching. Use this for ANY
 * music or playlist request ("play my hype playlist", "put on some music").
 */
export default async function (input: Input): Promise<string> {
  try {
    const result = await playPlaylistOnTV(input.query);
    return result.message;
  } catch (error) {
    if (error instanceof SpotifyNotConfiguredError) return error.message;
    return `Spotify playback failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
