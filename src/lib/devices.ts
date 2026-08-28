import { AppleTVDevice, scan } from "@bharper/atv-js";
import { NotPairedError } from "./errors";
import { readJson, writeJson } from "./storage";

const SELECTED_DEVICE_KEY = "atv:device:selected";

/** Scan the local network for Apple TVs (mDNS, _companion-link._tcp). */
export async function scanForDevices(timeoutMs = 5000): Promise<AppleTVDevice[]> {
  return scan(timeoutMs, true);
}

/** Persist the device the user paired with so commands never need to re-scan. */
export async function saveSelectedDevice(device: AppleTVDevice): Promise<void> {
  await writeJson(SELECTED_DEVICE_KEY, device);
}

export async function loadSelectedDevice(): Promise<AppleTVDevice> {
  const device = await readJson<AppleTVDevice>(SELECTED_DEVICE_KEY);
  if (!device) {
    throw new NotPairedError();
  }
  return device;
}

export async function getSelectedDeviceOrNull(): Promise<AppleTVDevice | null> {
  try {
    return await readJson<AppleTVDevice>(SELECTED_DEVICE_KEY);
  } catch {
    return null;
  }
}

/**
 * Build a device record from a manually entered IP address, for networks
 * where mDNS discovery is blocked. The Companion port varies per device
 * (49152–49155), so it's user-overridable.
 */
export function deviceFromManualEntry(name: string, address: string, port = 49152): AppleTVDevice {
  return {
    name: name || "Apple TV",
    address,
    port,
    airplayPort: 7000,
    identifier: `manual-${address}`,
    model: "unknown",
    properties: {},
  };
}
