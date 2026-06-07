/**
 * Lean AirPlay-2 session orchestrator. Drives the protocol sequence required to
 * open the MRP data tunnel, distilled from bunatv's Airplay2Protocol (the
 * enterprise state-machine/recovery/storage scaffolding is dropped — the caller
 * owns credential persistence and reconnection):
 *
 *   transport.connect → pair-verify (AirPlayAuthClient) → enable control
 *   encryption → RTSP setupRemoteControl (event channel) → RECORD →
 *   setupDataStream (data channel) → derive datastream keys (with seed) →
 *   DataStreamChannel.connect → 2s feedback keepalive.
 *
 * Exposes `dataChannel` (emits "protobuf") for the MRP layer to ride.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { BunTCPTransport } from "./transport";
import { ChaCha20EncryptionLayer } from "./encryption";
import { HttpFramedChannel } from "./HttpFramedChannel";
import { AirPlayAuthClient, type AirPlayCredentials } from "./auth";
import { RtspSession, type RemoteControlSetupInfo, type DataStreamConfig } from "./rtsp";
import { DataStreamChannel } from "./datastream";
import { EventStreamChannel } from "./eventstream";
import { HkdfUtils } from "./crypto";
import { NonceFormat } from "./buffer-utils";
import type { ClientDeviceInfo } from "./identity";
import { createLogger } from "./logging";

const logger = createLogger("mrp:airplay2");

export interface Airplay2ConnectionInfo {
  address: string;
  port: number;
}

export interface Airplay2Options {
  onPinRequired?: () => Promise<string>;
}

export class Airplay2Protocol extends EventEmitter {
  private readonly transport = new BunTCPTransport();
  private readonly encryption = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap });
  private readonly channel: HttpFramedChannel;
  private readonly authClient: AirPlayAuthClient;
  private readonly rtsp: RtspSession;

  private sharedSecret?: Uint8Array;
  private keepAliveTimer?: NodeJS.Timeout;

  public dataChannel?: DataStreamChannel;
  private eventChannel?: EventStreamChannel;

  constructor(
    private readonly connectionInfo: Airplay2ConnectionInfo,
    private readonly clientDeviceInfo: ClientDeviceInfo,
    private readonly credentials: AirPlayCredentials,
  ) {
    super();
    this.channel = new HttpFramedChannel(this.transport, this.encryption);
    this.authClient = new AirPlayAuthClient(this.channel);
    this.rtsp = new RtspSession(this.channel);
    this.transport.on("error", (err) => this.emit("error", err));
  }

  async connect(options?: Airplay2Options): Promise<void> {
    await this.transport.connect(this.connectionInfo.address, this.connectionInfo.port, { timeout: 10000 });
    logger.debug("transport connected");

    const authResult = await this.authClient.authenticate(this.credentials, {
      onPinRequired: options?.onPinRequired,
    });
    this.sharedSecret = authResult.sharedSecret;
    this.encryption.enable(authResult.keys);
    logger.debug("control channel encrypted (pair-verify complete)");

    await this.setupRtspSession();
    logger.info("AirPlay session ready");
  }

  private async setupRtspSession(): Promise<void> {
    if (!this.sharedSecret) throw new Error("Shared secret unavailable for RTSP setup");

    const rc = await this.rtsp.setupRemoteControl(this.buildRemoteControlSetupInfo());
    if (!rc.eventPort) throw new Error("setupRemoteControl returned no eventPort");

    // Event channel (carries device→client events; encrypted with event keys).
    const eventEnc = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap });
    eventEnc.enable(HkdfUtils.deriveAirPlayEventKeysSync(this.sharedSecret));
    this.eventChannel = new EventStreamChannel({ address: this.connectionInfo.address, port: rc.eventPort }, eventEnc);
    await this.eventChannel.start();

    await this.rtsp.record();

    const streamConfig = this.buildDataStreamConfig();
    const ds = await this.rtsp.setupDataStream(streamConfig);
    if (!ds.dataPort) throw new Error("setupDataStream returned no dataPort");

    // Data channel (MRP rides this; keyed with the seed from streamConfig).
    const dataEnc = new ChaCha20EncryptionLayer({ format: NonceFormat.Hap });
    dataEnc.enable(HkdfUtils.deriveAirPlayDataStreamKeysSync(this.sharedSecret, streamConfig.seed));
    this.dataChannel = new DataStreamChannel({ address: this.connectionInfo.address, port: ds.dataPort }, dataEnc);
    await this.dataChannel.connect();
    this.dataChannel.on("protobuf", (data: Buffer) => this.emit("protobuf", data));
    logger.debug("data channel connected");

    this.startKeepAlive();
  }

  private buildRemoteControlSetupInfo(): RemoteControlSetupInfo {
    const c = this.clientDeviceInfo;
    return {
      osName: c.osName,
      sourceVersion: c.sourceVersion,
      timingProtocol: "None",
      model: c.model,
      deviceId: c.deviceId,
      osVersion: c.osVersion,
      osBuildVersion: c.osBuild,
      macAddress: c.mac,
      sessionUuid: randomUUID().toUpperCase(),
      name: c.name,
    };
  }

  private buildDataStreamConfig(): DataStreamConfig {
    return {
      channelId: randomUUID().toUpperCase(),
      seed: BigInt(Math.floor(Math.random() * 2 ** 32)),
      clientUuid: randomUUID().toUpperCase(),
    };
  }

  startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      this.rtsp.feedback().catch((err) => logger.warn(err, "feedback failed"));
    }, 2000);
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  /** Send an MRP protobuf message over the data channel. */
  sendProtobuf(bytes: Buffer): void {
    if (!this.dataChannel) throw new Error("Data channel not connected");
    this.dataChannel.sendProtobuf(bytes);
  }

  async disconnect(): Promise<void> {
    this.stopKeepAlive();
    try {
      await this.rtsp.teardown();
    } catch {
      /* best effort */
    }
    if (this.dataChannel) {
      await this.dataChannel.disconnect();
      this.dataChannel = undefined;
    }
    if (this.eventChannel) {
      await this.eventChannel.disconnect();
      this.eventChannel = undefined;
    }
    await this.transport.disconnect("client disconnect");
  }
}
