import { LocalStorage } from "@raycast/api";

/** JSON-valued entries in Raycast's encrypted LocalStorage. Missing keys read as `null`. */
export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await LocalStorage.getItem<string>(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await LocalStorage.setItem(key, JSON.stringify(value));
}
