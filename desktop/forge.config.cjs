const path = require("node:path");
const { FusesPlugin } = require("@electron-forge/plugin-fuses");
const { FuseV1Options, FuseVersion } = require("@electron/fuses");

const root = path.resolve(__dirname, "..");

module.exports = {
  packagerConfig: {
    name: "Workspace",
    executableName: "Workspace",
    icon: path.join(root, "desktop", "assets", "icon"),
    asar: true,
    ignore: [
      /^\/\.env(?:\..*)?$/,
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/\.pi(?:\/|$)/,
      /^\/desktop(?:\/|$)/,
      /^\/dist\/web-local(?:\/|$)/,
      /^\/docs(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/package-lock\.json$/,
      /^\/scripts(?:\/|$)/,
      /^\/src(?:\/|$)/,
      /^\/tests(?:\/|$)/,
      /^\/tsconfig(?:\..*)?\.json$/,
      /^\/web-local(?:\/|$)/,
      /^\/AGENTS\.md$/,
      /^\/README\.md$/,
      /^\/vite\.local\.config\.ts$/,
    ],
    extraResource: [
      path.join(root, "dist", "web-local"),
      path.join(root, "desktop", "assets"),
    ],
  },
  makers: [
    {
      name: "@electron-forge/maker-zip",
      platforms: ["win32"],
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      // Forge 7 currently peers on @electron/fuses v1, whose wire builder names
      // eight entries. Electron 42 adds WasmTrapHandlers at index 8; the package
      // verifier below asserts that ninth fuse remains enabled.
      strictlyRequireAllFuses: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // The stock Electron package does not include a browser-specific custom
      // snapshot, so keep the optional snapshot selector off.
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    }),
  ],
};
