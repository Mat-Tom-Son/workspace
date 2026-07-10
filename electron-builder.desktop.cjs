const path = require("node:path");

const root = __dirname;

module.exports = {
  appId: "io.github.mattomson.workspace",
  productName: "Workspace",
  artifactName: "Workspace-${version}-${os}.${ext}",
  forceCodeSigning: false,
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
  },
};
