export const restrictedAppRegistryVersionUnsupportedCode = "RESTRICTED_APP_REGISTRY_VERSION_UNSUPPORTED";

export class RestrictedAppRegistryVersionUnsupportedError extends Error {
  readonly code = restrictedAppRegistryVersionUnsupportedCode;
  readonly actualVersion: number | null;
  readonly supportedVersion: number;

  constructor(actualVersion: unknown, supportedVersion: number) {
    super("Restricted app registry version is unsupported.");
    this.name = "RestrictedAppRegistryVersionUnsupportedError";
    this.actualVersion = typeof actualVersion === "number" && Number.isSafeInteger(actualVersion)
      ? actualVersion
      : null;
    this.supportedVersion = supportedVersion;
  }
}

export function isNewerRestrictedAppRegistryVersionError(
  error: unknown,
): error is RestrictedAppRegistryVersionUnsupportedError & { actualVersion: number } {
  return error instanceof RestrictedAppRegistryVersionUnsupportedError
    && error.actualVersion !== null
    && error.actualVersion > error.supportedVersion;
}
