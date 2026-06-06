/**
 * Companion-protocol features that @bharper/atv-js doesn't expose yet:
 * app launching, installed-app listing, and sleep/wake. Payloads are ported
 * from pyatv's reference implementation (pyatv/protocols/companion/api.py)
 * and sent over the library's public `CompanionProtocol.sendCommand`, which
 * handles request/response correlation on the encrypted session.
 *
 * Worth upstreaming to https://github.com/bsharper/atvjs.
 */
import { AppleTVConnection, HidCommand } from "@bharper/atv-js";

/** pyatv `is_url_or_scheme`: URLs and custom schemes deep-link, bundle IDs launch. */
function isUrlOrScheme(value: string): boolean {
  return value.includes("://");
}

/**
 * Launch an app by bundle ID (e.g. `com.netflix.Netflix`) or deep-link a URL
 * (e.g. `https://www.netflix.com/title/80234304`).
 */
export async function launchApp(conn: AppleTVConnection, bundleIdOrUrl: string): Promise<void> {
  const key = isUrlOrScheme(bundleIdOrUrl) ? "_urlS" : "_bundleID";
  await conn.protocol.sendCommand("_launchApp", { [key]: bundleIdOrUrl });
}

/** Installed apps as a map of bundle ID → display name. */
export async function listApps(conn: AppleTVConnection): Promise<Record<string, string>> {
  const response = await conn.protocol.sendCommand("FetchLaunchableApplicationsEvent", {});
  return (response._c ?? {}) as Record<string, string>;
}

/**
 * Fire a HID command as a full button press. pyatv's sleep example sends only
 * the button-up event, but its HID helper presses down+up like a real button —
 * we match the helper.
 */
async function pressHid(conn: AppleTVConnection, command: HidCommand): Promise<void> {
  await conn.protocol.sendCommand("_hidC", { _hBtS: 1, _hidC: command });
  await conn.protocol.sendCommand("_hidC", { _hBtS: 2, _hidC: command });
}

export async function sleepDevice(conn: AppleTVConnection): Promise<void> {
  await pressHid(conn, HidCommand.Sleep);
}

export async function wakeDevice(conn: AppleTVConnection): Promise<void> {
  await pressHid(conn, HidCommand.Wake);
}
