import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  HeaderStyle,
  RateLimitState,
  RateLimitStateV3,
  AccountMetadataV1,
  AccountStorageV1,
  AccountMetadata,
  AccountStorage,
  AccountMetadataV3,
  AccountStorageV3,
  AnyAccountStorage,
  ModelFamily,
} from "./types";

export type { ModelFamily, HeaderStyle, AccountStorageV3, RateLimitStateV3, AccountMetadataV3 };

/**
 * Get Arctic config directory
 */
function getConfigDir(): string {
  return join(homedir(), ".arctic");
}

/**
 * Get the path to the antigravity accounts storage file
 */
export function getStoragePath(): string {
  return join(getConfigDir(), "antigravity-accounts.json");
}

/**
 * Migrate v1 storage to v2
 */
function migrateV1ToV2(v1: AccountStorageV1): AccountStorage {
  return {
    version: 2,
    accounts: v1.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitState = {};
      if (acc.isRateLimited && acc.rateLimitResetTime && acc.rateLimitResetTime > Date.now()) {
        rateLimitResetTimes.claude = acc.rateLimitResetTime;
        rateLimitResetTimes.gemini = acc.rateLimitResetTime;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0 ? rateLimitResetTimes : undefined,
      };
    }),
    activeIndex: v1.activeIndex,
  };
}

/**
 * Migrate v2 storage to v3
 */
export function migrateV2ToV3(v2: AccountStorage): AccountStorageV3 {
  return {
    version: 3,
    accounts: v2.accounts.map((acc) => {
      const rateLimitResetTimes: RateLimitStateV3 = {};
      if (acc.rateLimitResetTimes?.claude && acc.rateLimitResetTimes.claude > Date.now()) {
        rateLimitResetTimes.claude = acc.rateLimitResetTimes.claude;
      }
      if (acc.rateLimitResetTimes?.gemini && acc.rateLimitResetTimes.gemini > Date.now()) {
        rateLimitResetTimes["gemini-antigravity"] = acc.rateLimitResetTimes.gemini;
      }
      return {
        email: acc.email,
        refreshToken: acc.refreshToken,
        projectId: acc.projectId,
        managedProjectId: acc.managedProjectId,
        addedAt: acc.addedAt,
        lastUsed: acc.lastUsed,
        lastSwitchReason: acc.lastSwitchReason,
        rateLimitResetTimes: Object.keys(rateLimitResetTimes).length > 0 ? rateLimitResetTimes : undefined,
      };
    }),
    activeIndex: v2.activeIndex,
  };
}

/**
 * Load account storage from disk, with automatic migration
 */
export async function loadAccounts(): Promise<AccountStorageV3 | null> {
  try {
    const path = getStoragePath();
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content) as AnyAccountStorage;

    if (!Array.isArray(data.accounts)) {
      console.warn("[arctic-antigravity-auth] Invalid storage format, ignoring");
      return null;
    }

    let storage: AccountStorageV3;

    if (data.version === 1) {
      console.info("[arctic-antigravity-auth] Migrating account storage from v1 to v3");
      const v2 = migrateV1ToV2(data);
      storage = migrateV2ToV3(v2);
      try {
        await saveAccounts(storage);
        console.info("[arctic-antigravity-auth] Migration to v3 complete");
      } catch (saveError) {
        console.warn("[arctic-antigravity-auth] Failed to persist migrated storage:", saveError);
      }
    } else if (data.version === 2) {
      console.info("[arctic-antigravity-auth] Migrating account storage from v2 to v3");
      storage = migrateV2ToV3(data);
      try {
        await saveAccounts(storage);
        console.info("[arctic-antigravity-auth] Migration to v3 complete");
      } catch (saveError) {
        console.warn("[arctic-antigravity-auth] Failed to persist migrated storage:", saveError);
      }
    } else if (data.version === 3) {
      storage = data;
    } else {
      console.warn("[arctic-antigravity-auth] Unknown storage version, ignoring", {
        version: (data as { version?: unknown }).version,
      });
      return null;
    }

    if (typeof storage.activeIndex !== "number" || !Number.isInteger(storage.activeIndex)) {
      storage.activeIndex = 0;
    }

    if (storage.activeIndex < 0 || storage.activeIndex >= storage.accounts.length) {
      storage.activeIndex = 0;
    }

    return storage;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    console.error("[arctic-antigravity-auth] Failed to load account storage:", error);
    return null;
  }
}

/**
 * Save account storage to disk
 */
export async function saveAccounts(storage: AccountStorageV3): Promise<void> {
  const path = getStoragePath();
  await fs.mkdir(dirname(path), { recursive: true });

  const content = JSON.stringify(storage, null, 2);
  await fs.writeFile(path, content, "utf-8");
}

/**
 * Clear account storage from disk
 */
export async function clearAccounts(): Promise<void> {
  try {
    const path = getStoragePath();
    await fs.unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error("[arctic-antigravity-auth] Failed to clear account storage:", error);
    }
  }
}
