import type { SecretStore } from "@megan/core/platform/types";
import type { Db } from "@/db/client";
import { seal, unseal } from "@/lib/secret-box";
import { readSetting, writeSetting } from "@/lib/settings";

/**
 * The desktop's secrets: sealed rows in `app_settings`, exactly as the API
 * keys have always been stored (see secret-box.ts). On iOS the same
 * interface is the Keychain.
 *
 * `name` is the settings key, e.g. "gemini_api_key", so a key saved through
 * Settings and one read through here are the same row.
 */
export function settingsSecretStore(db?: Db): SecretStore {
  return {
    async get(name) {
      const stored = readSetting(name, db);
      return stored ? unseal(stored) : null;
    },
    async set(name, value) {
      writeSetting(name, value.trim() ? seal(value.trim()) : "", db);
    },
    async delete(name) {
      // An empty value deletes the row.
      writeSetting(name, "", db);
    },
  };
}
