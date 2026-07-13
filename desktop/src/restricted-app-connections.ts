import { safeStorage } from "electron";

import { EncryptedRestrictedAppConnectionStore } from "../../src/local/agent/restricted-app-connection-store.js";

export function createRestrictedAppConnectionStore(filePath: string): EncryptedRestrictedAppConnectionStore {
  return new EncryptedRestrictedAppConnectionStore(filePath, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(Buffer.from(ciphertext)),
  });
}
