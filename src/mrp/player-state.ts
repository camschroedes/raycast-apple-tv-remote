/**
 * MRP now-playing / current-app state. Logic ported from bunatv's
 * MRPPlayerState (merge timestamp-guard, position extrapolation, active-client
 * tracking), reimplemented to operate on protobufjs-decoded plain objects from
 * ./proto.ts rather than ts-proto classes.
 */
import { MessageType } from "./proto";

// CFAbsoluteTime (seconds since 2001-01-01) → Unix epoch.
const COCOA_EPOCH_OFFSET = 978307200;
const nowUnix = () => Date.now() / 1000;
const toUnixSeconds = (cocoa: number) => cocoa + COCOA_EPOCH_OFFSET;

export type PlaybackStatus = "playing" | "paused" | "seeking" | "stopped" | "idle" | "unknown";

export interface NowPlaying {
  title?: string;
  artist?: string;
  album?: string;
  /** Live extrapolated position in seconds. */
  elapsed?: number;
  duration?: number;
  /** 0..1 progress, when both elapsed and duration are known. */
  progress?: number;
  playbackState: PlaybackStatus;
  /** Bundle ID of the app that owns the current now-playing session. */
  app?: string;
  appName?: string;
}

interface NowPlayingInfo {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  elapsedTime?: number;
  playbackRate?: number;
  timestamp?: number; // CFAbsoluteTime snapshot
}

// Decoded-protobuf shapes (the fields we read from protobufjs plain objects).
interface ClientMsg {
  bundleIdentifier?: string;
  displayName?: string;
}
interface NowPlayingInfoMsg {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  elapsedTime?: number;
  playbackRate?: number;
  timestamp?: number;
}
interface SetStateMsg {
  playbackState?: number;
  playbackStateTimestamp?: number;
  nowPlayingInfo?: NowPlayingInfoMsg;
  playerPath?: { client?: ClientMsg };
}
interface DecodedMessage {
  type?: number;
  identifier?: string;
  setStateMessage?: SetStateMsg;
  setNowPlayingClientMessage?: { client?: ClientMsg };
}

function interpretState(playbackState: number | undefined, rate: number | undefined, hasInfo: boolean): PlaybackStatus {
  // PlaybackState.Enum: 1=Playing 2=Paused 3=Stopped 4=Interrupted 5=Seeking
  if (playbackState === 2) return hasInfo ? "paused" : "idle";
  if (playbackState === 3) return "stopped";
  if (playbackState === 1) {
    if (!rate || rate === 0) return "paused";
    if (Math.abs(rate - 1) < 0.01) return "playing";
    return "seeking";
  }
  if (playbackState === 5) return "seeking";
  return hasInfo ? "playing" : "unknown";
}

export class PlayerState {
  private info?: NowPlayingInfo;
  private playbackState?: number;
  private playbackStateTimestamp?: number;
  private activeBundleId?: string;
  private activeDisplayName?: string;
  // bundleId → display name, learned from playerPath/client messages.
  private readonly clientNames = new Map<string, string>();

  /** Feed a decoded ProtocolMessage (plain object) into the state machine. */
  handle(message: Record<string, unknown>): void {
    const msg = message as DecodedMessage;
    switch (msg.type) {
      case MessageType.SET_STATE:
        this.handleSetState(msg.setStateMessage ?? {});
        break;
      case MessageType.SET_NOW_PLAYING_CLIENT:
        this.handleNowPlayingClient(msg.setNowPlayingClientMessage?.client);
        break;
      default:
        break;
    }
  }

  private handleSetState(m: SetStateMsg): void {
    const incomingTs: number | undefined = m.playbackStateTimestamp;
    // Drop out-of-order updates (timestamp guard).
    if (incomingTs != null && this.playbackStateTimestamp != null && incomingTs < this.playbackStateTimestamp) {
      return;
    }
    if (incomingTs != null) this.playbackStateTimestamp = incomingTs;
    if (m.playbackState != null) this.playbackState = m.playbackState;
    if (m.nowPlayingInfo) {
      const npi = m.nowPlayingInfo;
      this.info = {
        title: npi.title,
        artist: npi.artist,
        album: npi.album,
        duration: npi.duration,
        elapsedTime: npi.elapsedTime,
        playbackRate: npi.playbackRate,
        timestamp: npi.timestamp,
      };
    }
    const client = m.playerPath?.client;
    if (client?.bundleIdentifier) {
      if (client.displayName) this.clientNames.set(client.bundleIdentifier, client.displayName);
      // SetState's playerPath identifies which app this state belongs to.
      if (!this.activeBundleId) this.activeBundleId = client.bundleIdentifier;
    }
  }

  private handleNowPlayingClient(client: ClientMsg | undefined): void {
    if (!client) {
      this.activeBundleId = undefined;
      this.activeDisplayName = undefined;
      return;
    }
    this.activeBundleId = client.bundleIdentifier;
    this.activeDisplayName = client.displayName ?? this.clientNames.get(client.bundleIdentifier ?? "");
    if (client.bundleIdentifier && client.displayName) {
      this.clientNames.set(client.bundleIdentifier, client.displayName);
    }
  }

  /** Current foreground media app bundle id (or undefined if none). */
  getCurrentApp(): { bundleId?: string; name?: string } {
    return {
      bundleId: this.activeBundleId,
      name: this.activeDisplayName ?? (this.activeBundleId ? this.clientNames.get(this.activeBundleId) : undefined),
    };
  }

  /** Snapshot of what's playing, with the elapsed position extrapolated to now. */
  getNowPlaying(): NowPlaying {
    const info = this.info;
    const hasInfo = !!(info && (info.title || info.artist || info.album));
    const state = interpretState(this.playbackState, info?.playbackRate, hasInfo);

    let elapsed = info?.elapsedTime;
    if (elapsed != null && info?.timestamp != null && info.playbackRate) {
      const delta = (nowUnix() - toUnixSeconds(info.timestamp)) * info.playbackRate;
      elapsed = Math.max(0, elapsed + delta);
    }
    const duration = info?.duration;
    const progress =
      elapsed != null && duration && duration > 0 ? Math.min(1, Math.max(0, elapsed / duration)) : undefined;

    const app = this.getCurrentApp();
    return {
      title: info?.title,
      artist: info?.artist,
      album: info?.album,
      elapsed,
      duration,
      progress,
      playbackState: state,
      app: app.bundleId,
      appName: app.name,
    };
  }
}
