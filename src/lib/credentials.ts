import { Credentials } from "@bharper/atv-js";
import { NotPairedError } from "./errors";
import { readJson, writeJson } from "./storage";

// Pairing credentials are machine-generated key material (not user-entered
// secrets), so they live in Raycast's encrypted LocalStorage database rather
// than extension preferences. Keychain access is intentionally not used.
const credsKey = (deviceId: string) => `atv:creds:${deviceId}`;

export async function saveCredentials(deviceId: string, creds: Credentials): Promise<void> {
  await writeJson(credsKey(deviceId), creds);
}

export async function loadCredentials(deviceId: string): Promise<Credentials> {
  const creds = await readJson<Credentials>(credsKey(deviceId));
  if (!creds) {
    throw new NotPairedError();
  }
  return creds;
}
