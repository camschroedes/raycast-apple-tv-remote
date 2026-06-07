import { LocalStorage } from "@raycast/api";
import { AppleTVDevice } from "@bharper/atv-js";
import { NowPlayingClient, pairAirPlay, generateClientDeviceInfo, type AirPlayCredentials } from "../mrp/now-playing";
import type { ClientDeviceInfo } from "../mrp/identity";
import type { NowPlaying } from "../mrp/player-state";

/**
 * Now-playing over the MRP-over-AirPlay tunnel. AirPlay pairing is SEPARATE from
 * the Companion remote pairing (a second PIN), so it gets its own credentials in
 * LocalStorage (machine-generated key material, same rationale as the remote
 * credentials). The menu bar opens a short-lived tunnel per refresh to snapshot
 * what's playing — Companion alone can't see playback state.
 */

const CLIENT_INFO_KEY = "nowplaying.clientDeviceInfo";
const credsKey = (deviceId: string) => `nowplaying.airplay.${deviceId}`;

interface SerializedCreds {
  identifier: string;
  publicKey: string;
  privateKey: string;
  serverPublicKey: string;
}

function serialize(c: AirPlayCredentials): SerializedCreds {
  return {
    identifier: c.identifier,
    publicKey: Buffer.from(c.publicKey).toString("hex"),
    privateKey: Buffer.from(c.privateKey).toString("hex"),
    serverPublicKey: Buffer.from(c.serverPublicKey).toString("hex"),
  };
}

function deserialize(s: SerializedCreds): AirPlayCredentials {
  return {
    identifier: s.identifier,
    publicKey: Buffer.from(s.publicKey, "hex"),
    privateKey: Buffer.from(s.privateKey, "hex"),
    serverPublicKey: Buffer.from(s.serverPublicKey, "hex"),
  };
}

/** Stable client identity, generated once and reused (the device tracks it). */
async function getClientDeviceInfo(): Promise<ClientDeviceInfo> {
  const raw = await LocalStorage.getItem<string>(CLIENT_INFO_KEY);
  if (raw) return JSON.parse(raw) as ClientDeviceInfo;
  const info = generateClientDeviceInfo("Apple TV Remote (Raycast)");
  await LocalStorage.setItem(CLIENT_INFO_KEY, JSON.stringify(info));
  return info;
}

export async function isNowPlayingPaired(device: AppleTVDevice): Promise<boolean> {
  return (await LocalStorage.getItem<string>(credsKey(device.identifier))) !== undefined;
}

/**
 * Run AirPlay pair-setup. `onPinRequired` fires once the TV shows its PIN;
 * resolve it with the entered code. Persists credentials on success.
 */
export async function pairNowPlaying(device: AppleTVDevice, onPinRequired: () => Promise<string>): Promise<void> {
  const creds = await pairAirPlay({ address: device.address, port: device.airplayPort }, onPinRequired);
  await LocalStorage.setItem(credsKey(device.identifier), JSON.stringify(serialize(creds)));
  // Ensure the client identity exists too.
  await getClientDeviceInfo();
}

export async function forgetNowPlaying(device: AppleTVDevice): Promise<void> {
  await LocalStorage.removeItem(credsKey(device.identifier));
}

/**
 * Open a short-lived tunnel, snapshot what's playing, and tear it down. Returns
 * `null` if AirPlay isn't paired for this device.
 */
export async function getNowPlayingSnapshot(device: AppleTVDevice): Promise<NowPlaying | null> {
  const raw = await LocalStorage.getItem<string>(credsKey(device.identifier));
  if (!raw) return null;
  const creds = deserialize(JSON.parse(raw) as SerializedCreds);
  const info = await getClientDeviceInfo();
  const client = new NowPlayingClient({ address: device.address, port: device.airplayPort }, info, creds);
  try {
    await client.start();
    return client.getNowPlaying();
  } finally {
    await client.stop().catch(() => undefined);
  }
}

export type { NowPlaying } from "../mrp/player-state";
