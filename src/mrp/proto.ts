/**
 * MRP protobuf codec. Uses protobufjs at runtime with the schema embedded as a
 * string (no codegen, no file lookup → bundles cleanly into Raycast). The
 * schema mirrors src/mrp/mrp.proto; proto2 extensions are declared as
 * wire-identical regular fields. Pure JS — no native addons.
 */
import protobuf from "protobufjs";

// Message-type tags (ProtocolMessage.Type enum values), verbatim from pyatv.
export const MessageType = {
  SET_STATE: 4,
  DEVICE_INFO: 15,
  CLIENT_UPDATES_CONFIG: 16,
  GET_KEYBOARD_SESSION: 24,
  SET_CONNECTION_STATE: 38,
  SET_NOW_PLAYING_CLIENT: 46,
  SET_NOW_PLAYING_PLAYER: 47,
  UPDATE_CONTENT_ITEM: 56,
} as const;

const SCHEMA = `
syntax = "proto2";
package mrp;
message NowPlayingInfo {
  optional string album = 1;
  optional string artist = 2;
  optional double duration = 3;
  optional double elapsedTime = 4;
  optional float playbackRate = 5;
  optional double timestamp = 8;
  optional string title = 9;
  optional uint64 uniqueIdentifier = 10;
}
message NowPlayingClient {
  optional string bundleIdentifier = 2;
  optional string parentApplicationBundleIdentifier = 3;
  optional string displayName = 7;
}
message PlayerPath { optional NowPlayingClient client = 2; }
message SetStateMessage {
  optional NowPlayingInfo nowPlayingInfo = 1;
  optional int32 playbackState = 6;
  optional PlayerPath playerPath = 9;
  optional double playbackStateTimestamp = 11;
}
message SetNowPlayingClientMessage { optional NowPlayingClient client = 1; }
message DeviceInfoMessage {
  optional string uniqueIdentifier = 1;
  required string name = 2;
  optional string localizedModelName = 3;
  optional string systemBuildVersion = 4;
  optional string applicationBundleIdentifier = 5;
  optional string applicationBundleVersion = 6;
  optional int32 protocolVersion = 7;
  optional uint32 lastSupportedMessageType = 8;
  optional bool supportsSystemPairing = 9;
  optional bool allowsPairing = 10;
  optional string systemMediaApplication = 12;
  optional bool supportsACL = 13;
  optional bool supportsSharedQueue = 14;
  optional bool supportsExtendedMotion = 15;
  optional uint32 sharedQueueVersion = 17;
  optional int32 deviceClass = 21;
  optional uint32 logicalDeviceCount = 22;
}
message SetConnectionStateMessage { optional int32 state = 1; }
message ClientUpdatesConfigMessage {
  // Field numbers per pyatv (canonical): artwork=1, nowPlaying=2. (bunatv had
  // these swapped, which would tag nowPlayingUpdates as artworkUpdates on the
  // wire and suppress all SET_STATE pushes.) No systemEndpointUpdates field.
  optional bool artworkUpdates = 1;
  optional bool nowPlayingUpdates = 2;
  optional bool volumeUpdates = 3;
  optional bool keyboardUpdates = 4;
  optional bool outputDeviceUpdates = 5;
}
message ProtocolMessage {
  optional int32 type = 1;
  optional string identifier = 2;
  optional int32 errorCode = 4;
  optional uint64 timestamp = 5;
  optional string uniqueIdentifier = 85;
  optional SetStateMessage setStateMessage = 9;
  optional DeviceInfoMessage deviceInfoMessage = 20;
  optional ClientUpdatesConfigMessage clientUpdatesConfigMessage = 21;
  optional SetConnectionStateMessage setConnectionStateMessage = 42;
  optional SetNowPlayingClientMessage setNowPlayingClientMessage = 50;
}
`;

const root = protobuf.parse(SCHEMA, { keepCase: true }).root;
const ProtocolMessage = root.lookupType("mrp.ProtocolMessage");

/** Decode a ProtocolMessage wire buffer into a plain JS object. */
export function decodeProtocolMessage(buf: Buffer): Record<string, unknown> {
  const msg = ProtocolMessage.decode(buf);
  return ProtocolMessage.toObject(msg, { longs: Number, defaults: false }) as Record<string, unknown>;
}

/** Encode a plain JS ProtocolMessage object to a wire buffer. */
export function encodeProtocolMessage(obj: Record<string, unknown>): Buffer {
  const err = ProtocolMessage.verify(obj);
  if (err) throw new Error(`ProtocolMessage verify failed: ${err}`);
  return Buffer.from(ProtocolMessage.encode(ProtocolMessage.create(obj)).finish());
}
