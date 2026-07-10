const path = require("node:path");

const root = __dirname;

module.exports = {
  appId: "io.github.mattomson.workspace",
  productName: "Workspace",
  copyright: "Copyright © 2026 Mat-Tom-Son",
  artifactName: "Workspace-${version}-${os}.${ext}",
  forceCodeSigning: process.env.WORKSPACE_REQUIRE_CODE_SIGNING === "1",
  electronUpdaterCompatibility: ">=2.16",
  generateUpdatesFilesForAllChannels: false,
  publish: [
    {
      provider: "github",
      owner: "Mat-Tom-Son",
      repo: "workspace",
      releaseType: "release",
    },
  ],
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },
  directories: {
    output: "out/builder",
    buildResources: "desktop/assets",
  },
  files: ["package.json", "dist/desktop/**/*"],
  extraResources: [
    {
      from: "dist/web-local",
      to: "web-local",
    },
    {
      from: "desktop/assets",
      to: "assets",
    },
  ],
  asar: true,
  compression: "normal",
  npmRebuild: false,
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"],
      },
    ],
    icon: path.join(root, "desktop", "assets", "icon.ico"),
    executableName: "Workspace",
    // A self-signed certificate is useful for personal artifact continuity but
    // is not a public trust anchor. Enable updater Authenticode enforcement only
    // after a CA-backed publisher identity has been configured and tested.
    verifyUpdateCodeSignature: process.env.WORKSPACE_TRUSTED_CODE_SIGNING === "1",
    signtoolOptions: {
      signingHashAlgorithms: ["sha256"],
      rfc3161TimeStampServer: "http://timestamp.digicert.com",
    },
  },
  nsis: {
    artifactName: "Workspace-Setup-${version}.${ext}",
    uninstallDisplayName: "Workspace",
    shortcutName: "Workspace",
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: true,
  },
};
