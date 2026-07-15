ObjC.import("Foundation");
ObjC.import("stdlib");

function run(rawArguments) {
  const argumentsList = Array.from(rawArguments);
  const scriptDirectory = argumentsList.shift();
  const fileManager = $.NSFileManager.defaultManager;
  let temporaryRequestPath = "";
  let requestPath = "";
  let responsePath = "";
  let exitCode = 1;

  try {
    const homeDirectory = environmentValue("HOME") || ObjC.unwrap($.NSHomeDirectory());
    const configuredStateRoot = environmentValue("WORKSPACE_DESKTOP_USER_DATA_DIR");
    const stateRoot = configuredStateRoot || `${homeDirectory}/Library/Application Support/Workspace`;
    const cliRoot = `${stateRoot}/cli`;
    const requestDirectory = `${cliRoot}/requests`;
    const responseDirectory = `${cliRoot}/responses`;
    createDirectory(requestDirectory);
    createDirectory(responseDirectory);

    const configuredAppPath = environmentValue("WORKSPACE_CLI_APP");
    const bundledAppPaths = [
      `${scriptDirectory}/../MacOS/Workspace`,
      `${scriptDirectory}/../MacOS/Workspace Local Smoke`,
    ];
    const appPath = configuredAppPath || bundledAppPaths.find((path) => fileManager.fileExistsAtPath($(path))) || bundledAppPaths[0];
    if (!fileManager.fileExistsAtPath($(appPath))) {
      throw new Error(`Workspace executable was not found at ${appPath}.`);
    }

    const timeoutValue = environmentValue("WORKSPACE_CLI_TIMEOUT_MS");
    const timeoutMs = timeoutValue ? Number(timeoutValue) : 120000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) {
      throw new Error("WORKSPACE_CLI_TIMEOUT_MS must be an integer between 100 and 600000.");
    }

    const requestId = ObjC.unwrap($.NSUUID.UUID.UUIDString).toLowerCase();
    requestPath = `${requestDirectory}/${requestId}.json`;
    responsePath = `${responseDirectory}/${requestId}.json`;
    temporaryRequestPath = `${requestDirectory}/${requestId}.${ObjC.unwrap($.NSUUID.UUID.UUIDString).toLowerCase()}.tmp`;
    const request = {
      protocolVersion: 1,
      id: requestId,
      argv: argumentsList,
      cwd: ObjC.unwrap(fileManager.currentDirectoryPath),
      createdAt: new Date().toISOString(),
    };
    writeText(temporaryRequestPath, JSON.stringify(request));
    if (!fileManager.moveItemAtPathToPathError($(temporaryRequestPath), $(requestPath), null)) {
      throw new Error("Workspace CLI request could not be committed.");
    }
    temporaryRequestPath = "";

    const task = $.NSTask.alloc.init;
    task.executableURL = $.NSURL.fileURLWithPath($(appPath));
    task.arguments = $(["--workspace-cli-request", requestId]);
    if (!task.launchAndReturnError(null)) throw new Error("Workspace executable could not be launched.");

    const deadline = Date.now() + timeoutMs;
    while (!fileManager.fileExistsAtPath($(responsePath))) {
      if (Date.now() >= deadline) {
        exitCode = 124;
        throw new Error(`Workspace did not answer CLI request ${requestId} within ${timeoutMs} ms.`);
      }
      $.NSThread.sleepForTimeInterval(0.05);
    }

    const response = JSON.parse(readText(responsePath));
    if (response.protocolVersion !== 1) throw new Error(`Workspace returned unsupported CLI protocol version ${response.protocolVersion}.`);
    if (response.id !== requestId) throw new Error("Workspace returned a CLI response with the wrong request id.");
    if (!Number.isInteger(response.exitCode)) throw new Error("Workspace returned an invalid CLI exit code.");
    writeHandle($.NSFileHandle.fileHandleWithStandardOutput, typeof response.stdout === "string" ? response.stdout : "");
    writeHandle($.NSFileHandle.fileHandleWithStandardError, typeof response.stderr === "string" ? response.stderr : "");
    exitCode = response.exitCode;
  } catch (error) {
    writeHandle($.NSFileHandle.fileHandleWithStandardError, `workspace: ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    for (const path of [temporaryRequestPath, requestPath, responsePath]) {
      if (path && fileManager.fileExistsAtPath($(path))) fileManager.removeItemAtPathError($(path), null);
    }
  }

  $.exit(exitCode);
}

function environmentValue(name) {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey($(name));
  const unwrapped = ObjC.unwrap(value);
  return typeof unwrapped === "string" ? unwrapped.trim() : "";
}

function createDirectory(path) {
  if (!$.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
    $(path),
    true,
    $.NSDictionary.dictionary,
    null,
  )) {
    throw new Error(`Workspace CLI directory could not be created at ${path}.`);
  }
}

function writeText(path, text) {
  const data = $(text).dataUsingEncoding($.NSUTF8StringEncoding);
  if (!data.writeToFileAtomically($(path), true)) throw new Error(`Workspace CLI request could not be written at ${path}.`);
}

function readText(path) {
  const value = $.NSString.stringWithContentsOfFileEncodingError($(path), $.NSUTF8StringEncoding, null);
  if (!value) throw new Error(`Workspace CLI response could not be read at ${path}.`);
  return ObjC.unwrap(value);
}

function writeHandle(handle, text) {
  if (!text) return;
  handle.writeData($(text).dataUsingEncoding($.NSUTF8StringEncoding));
}
