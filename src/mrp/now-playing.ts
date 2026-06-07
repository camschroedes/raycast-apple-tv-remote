/**
 * Top-level "verifiable now-playing" client: opens the AirPlay-2 MRP tunnel,
 * runs the MRP handshake, and exposes the live now-playing / current-app state.
 * This is the public entry the MCP server (and the Raycast extension) call.
 */
import { randomUUID } from "node:crypto";
import { Airplay2Protocol, type Airplay2ConnectionInfo, type Airplay2Options } from "./airplay2";
import { AirPlayAuthClient, type AirPlayCredentials } from "./auth";
import { BunTCPTransport } from "./transport";
import { HttpFramedChannel } from "./HttpFramedChannel";
import { ChaCha20EncryptionLayer } from "./encryption";
import { NonceFormat } from "./buffer-utils";
import type { ClientDeviceInfo } from "./identity";
import { PlayerState, type NowPlaying } from "./player-state";
import { MessageType, decodeProtocolMessage, encodeProtocolMessage } from "./proto";
import { createLogger } from "./logging";

const logger = createLogger("mrp:now-playing");

/**
 * Run AirPlay HAP pair-setup (the 4-digit PIN flow) to obtain the long-term
 * credentials that pair-verify needs each session. `onPinRequired` is invoked
 * once the device shows its PIN; resolve it with the entered code.
 */
export async function pairAirPlay(
  connectionInfo: Airplay2ConnectionInfo,
  onPinRequired: () => Promise<string>,
): Promise<AirPlayCredentials> {
  const transport = new BunTCPTransport();
  await transport.connect(connectionInfo.address, connectionInfo.port, { timeout: 10000 });
  try {
    const channel = new HttpFramedChannel(transport, new ChaCha20EncryptionLayer({ format: NonceFormat.Hap }));
    const authClient = new AirPlayAuthClient(channel);
    const result = await authClient.authenticate(undefined, { onPinRequired });
    if (!result.credentials) throw new Error("AirPlay pairing did not yield credentials");
    return result.credentials;
  } finally {
    await transport.disconnect("pairing complete");
  }
}

export class NowPlayingClient {
  private readonly airplay: Airplay2Protocol;
  private readonly state = new PlayerState();
  private started = false;
  // identifier → resolver, for send-and-receive correlation during handshake.
  private readonly pending = new Map<string, (msg: Record<string, unknown>) => void>();

  constructor(
    connectionInfo: Airplay2ConnectionInfo,
    private readonly clientDeviceInfo: ClientDeviceInfo,
    credentials: AirPlayCredentials,
  ) {
    this.airplay = new Airplay2Protocol(connectionInfo, clientDeviceInfo, credentials);
    this.airplay.on("protobuf", (bytes: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = decodeProtocolMessage(bytes);
      } catch (err) {
        logger.warn(err, "failed to decode MRP message");
        return;
      }
      // Resolve any awaiting send-and-receive, then always update state.
      const id = msg.identifier as string | undefined;
      if (id && this.pending.has(id)) {
        this.pending.get(id)!(msg);
        this.pending.delete(id);
      }
      this.state.handle(msg);
    });
  }

  /** Connect the tunnel and run the MRP handshake. Idempotent. */
  async start(options?: Airplay2Options): Promise<void> {
    if (this.started) return;
    await this.airplay.connect(options);
    await this.handshake();
    this.started = true;
    // Brief settle for the device's first state push after subscribing.
    await new Promise((r) => setTimeout(r, 1200));
  }

  /** Canonical MRP handshake (matches pyatv MrpProtocol.start). */
  private async handshake(): Promise<void> {
    // 1. DeviceInfo — identify as a TV Remote client; wait for the device reply.
    await this.sendAndReceive(MessageType.DEVICE_INFO, {
      deviceInfoMessage: {
        uniqueIdentifier: this.clientDeviceInfo.uniqueIdentifier,
        name: this.clientDeviceInfo.name,
        localizedModelName: "iPhone",
        systemBuildVersion: this.clientDeviceInfo.osBuild,
        applicationBundleIdentifier: "com.apple.TVRemote",
        applicationBundleVersion: "344.28",
        protocolVersion: 1,
        lastSupportedMessageType: 108,
        supportsSystemPairing: true,
        allowsPairing: true,
        systemMediaApplication: "com.apple.TVMusic",
        supportsACL: true,
        supportsSharedQueue: true,
        supportsExtendedMotion: true,
        sharedQueueVersion: 2,
        deviceClass: 1,
        logicalDeviceCount: 1,
      },
    });
    // 2. Connection state → Connected (fire-and-forget, as pyatv does).
    this.send(MessageType.SET_CONNECTION_STATE, { setConnectionStateMessage: { state: 2 } });
    // 3. Subscribe to updates. Enable artwork+nowPlaying+volume+keyboard like
    //    pyatv; nowPlayingUpdates (field 2) is what unlocks SET_STATE pushes.
    await this.sendAndReceive(MessageType.CLIENT_UPDATES_CONFIG, {
      clientUpdatesConfigMessage: {
        artworkUpdates: true,
        nowPlayingUpdates: true,
        volumeUpdates: true,
        keyboardUpdates: true,
        outputDeviceUpdates: false,
      },
    });
    // 4. Complete the canonical handshake (some firmware expects it before
    //    pushing state). GET_KEYBOARD_SESSION has no extension body.
    await this.sendAndReceive(MessageType.GET_KEYBOARD_SESSION, {});
  }

  private send(type: number, fields: Record<string, unknown>): string {
    const identifier = randomUUID();
    this.airplay.sendProtobuf(encodeProtocolMessage({ type, identifier, ...fields }));
    return identifier;
  }

  /** Send a message and resolve when the reply with the same identifier arrives (or after a timeout). */
  private sendAndReceive(type: number, fields: Record<string, unknown>, timeoutMs = 3000): Promise<void> {
    const identifier = this.send(type, fields);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(identifier);
        resolve(); // tolerate no reply — proceed with the handshake regardless
      }, timeoutMs);
      this.pending.set(identifier, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  getNowPlaying(): NowPlaying {
    return this.state.getNowPlaying();
  }

  getCurrentApp(): { bundleId?: string; name?: string } {
    return this.state.getCurrentApp();
  }

  async stop(): Promise<void> {
    await this.airplay.disconnect();
    this.started = false;
  }
}

export type { NowPlaying } from "./player-state";
export type { AirPlayCredentials } from "./auth";
export { generateClientDeviceInfo } from "./identity";
export { AirPlayAuthClient } from "./auth";
