import {
  WORKSPACE_CLI_PROTOCOL_VERSION,
  WorkspaceCliError,
  WorkspaceCliExitCode,
  createWorkspaceCliResponse,
  type WorkspaceCliActor,
  type WorkspaceCliCapabilitySummary,
  type WorkspaceCliCommandName,
  type WorkspaceCliContextSnapshot,
  type WorkspaceCliJson,
  type WorkspaceCliKernel,
  type WorkspaceCliOutputMode,
  type WorkspaceCliParsedCommand,
  type WorkspaceCliRequestV1,
  type WorkspaceCliResponseV1,
  type WorkspaceCliSpaceSummary,
  type WorkspaceCliTaskSummary,
} from "./protocol.js";

export interface WorkspaceCliExecutorOptions {
  version: string;
  productName?: string;
  now?: () => Date;
}

export interface WorkspaceCliCommandResult {
  command: WorkspaceCliCommandName;
  data: WorkspaceCliJson;
}

const commandPatterns: Array<{ tokens: string[]; name: WorkspaceCliCommandName }> = [
  { tokens: ["context"], name: "context" },
  { tokens: ["spaces", "list"], name: "spaces.list" },
  { tokens: ["tasks", "list"], name: "tasks.list" },
  { tokens: ["capabilities", "list"], name: "capabilities.list" },
];

export function parseWorkspaceCliArgv(argv: readonly string[]): WorkspaceCliParsedCommand {
  let output: WorkspaceCliOutputMode = "human";
  let space: string | undefined;
  let help = false;
  let version = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (token === "--json") {
      output = "json";
      continue;
    }
    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }
    if (token === "--version" || token === "-v") {
      version = true;
      continue;
    }
    if (token === "--space") {
      if (space !== undefined) throw usageError("--space may be provided only once.");
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw usageError("--space requires a Space id or name.");
      space = normalizeSpaceSelector(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--space=")) {
      if (space !== undefined) throw usageError("--space may be provided only once.");
      space = normalizeSpaceSelector(token.slice("--space=".length));
      continue;
    }
    if (token.startsWith("-")) throw usageError(`Unknown option: ${token}`);
    positional.push(token);
  }

  if (help) {
    return {
      name: "help",
      output,
      ...(positional.length ? { topic: positional.join(" ") } : {}),
    };
  }
  if (version) {
    if (positional.length || space !== undefined) throw usageError("--version cannot be combined with a command or --space.");
    return { name: "version", output };
  }
  if (!positional.length) {
    if (space !== undefined) throw usageError("--space must be used with context, spaces list, tasks list, or capabilities list.");
    return { name: "help", output };
  }
  if (positional[0] === "help") {
    return { name: "help", output, ...(positional.length > 1 ? { topic: positional.slice(1).join(" ") } : {}) };
  }
  if (positional[0] === "version") {
    if (positional.length !== 1 || space !== undefined) throw usageError("version does not accept arguments or --space.");
    return { name: "version", output };
  }

  const matched = commandPatterns.find(({ tokens }) => tokens.length === positional.length && tokens.every((token, index) => positional[index] === token));
  if (!matched) throw usageError(`Unknown command: ${positional.join(" ")}`);
  return { name: matched.name, output, ...(space ? { space } : {}) };
}

export async function executeWorkspaceCliRequest(
  request: WorkspaceCliRequestV1,
  kernel: WorkspaceCliKernel,
  options: WorkspaceCliExecutorOptions,
): Promise<WorkspaceCliResponseV1> {
  const completedAt = () => (options.now?.() ?? new Date()).toISOString();
  let command: WorkspaceCliParsedCommand | undefined;
  try {
    command = parseWorkspaceCliArgv(request.argv);
    const actor: WorkspaceCliActor = { kind: "cli", cwd: request.cwd };
    const result = await runCommand(command, actor, kernel, options);
    return createWorkspaceCliResponse({
      id: request.id,
      exitCode: WorkspaceCliExitCode.success,
      stdout: command.output === "json" ? `${JSON.stringify({ ok: true, command: result.command, data: result.data }, null, 2)}\n` : humanOutput(result, options),
      stderr: "",
      result: result.data,
      completedAt: completedAt(),
    });
  } catch (error) {
    const normalized = normalizeCommandError(error);
    const json = command?.output === "json" || request.argv.includes("--json");
    return createWorkspaceCliResponse({
      id: request.id,
      exitCode: normalized.exitCode,
      stdout: "",
      stderr: json
        ? `${JSON.stringify({ ok: false, error: { code: normalized.code, message: normalized.message } }, null, 2)}\n`
        : `${humanErrorMessage(normalized)}\n`,
      result: { ok: false, error: { code: normalized.code, message: normalized.message } },
      completedAt: completedAt(),
    });
  }
}

export function workspaceCliHelp(productName = "Workspace", topic?: string): string {
  const executable = "workspace";
  const normalizedTopic = topic?.trim().toLocaleLowerCase();
  const header = `${terminalText(productName)} CLI`;
  if (normalizedTopic === "context") return `${header}\n\nUsage: ${executable} context [--space <id-or-name>] [--json]\n\nShow the resolved Space and host context for this working directory.\n`;
  if (normalizedTopic === "spaces" || normalizedTopic === "spaces list") return `${header}\n\nUsage: ${executable} spaces list [--space <id-or-name>] [--json]\n\nList Spaces visible to this user.\n`;
  if (normalizedTopic === "tasks" || normalizedTopic === "tasks list") return `${header}\n\nUsage: ${executable} tasks list [--space <id-or-name>] [--json]\n\nList host-managed tasks, optionally for one Space.\n`;
  if (normalizedTopic === "capabilities" || normalizedTopic === "capabilities list") return `${header}\n\nUsage: ${executable} capabilities list [--space <id-or-name>] [--json]\n\nList Personal and Space capabilities.\n`;
  return [
    header,
    "",
    `Usage: ${executable} [--json] <command> [--space <id-or-name>]`,
    "",
    "Commands:",
    "  context             Show the resolved Space and host context",
    "  spaces list         List Spaces",
    "  tasks list          List host-managed tasks",
    "  capabilities list   List Assistant capabilities",
    "  version             Show the installed Workspace version",
    "  help [command]      Show command help",
    "",
    "Options:",
    "  --space <value>     Select a Space by id or exact name",
    "  --json              Emit stable JSON output",
    "  -h, --help          Show help",
    "  -v, --version       Show the version",
    "",
  ].join("\n");
}

async function runCommand(
  command: WorkspaceCliParsedCommand,
  actor: WorkspaceCliActor,
  kernel: WorkspaceCliKernel,
  options: WorkspaceCliExecutorOptions,
): Promise<WorkspaceCliCommandResult> {
  switch (command.name) {
    case "help":
      return {
        command: command.name,
        data: {
          product: options.productName ?? "Workspace",
          protocolVersion: WORKSPACE_CLI_PROTOCOL_VERSION,
          topic: command.topic ?? null,
          text: workspaceCliHelp(options.productName, command.topic),
        },
      };
    case "version":
      return {
        command: command.name,
        data: {
          name: options.productName ?? "Workspace",
          version: options.version,
          protocolVersion: WORKSPACE_CLI_PROTOCOL_VERSION,
        },
      };
    case "context":
      return { command: command.name, data: contextJson(await kernel.getContext(actor, { space: command.space })) };
    case "spaces.list":
      return { command: command.name, data: spacesJson(await kernel.listSpaces(actor, { space: command.space })) };
    case "tasks.list":
      return { command: command.name, data: tasksJson(await kernel.listTasks(actor, { space: command.space })) };
    case "capabilities.list":
      return { command: command.name, data: capabilitiesJson(await kernel.listCapabilities(actor, { space: command.space })) };
  }
}

function humanOutput(result: WorkspaceCliCommandResult, options: WorkspaceCliExecutorOptions): string {
  switch (result.command) {
    case "help":
      return `${String((result.data as { text: string }).text).trimEnd()}\n`;
    case "version": {
      const data = result.data as { name: string; version: string };
      return `${terminalText(data.name)} ${terminalText(data.version)}\n`;
    }
    case "context":
      return humanContext(result.data as unknown as WorkspaceCliContextSnapshot);
    case "spaces.list":
      return humanSpaces((result.data as unknown as { spaces: WorkspaceCliSpaceSummary[] }).spaces);
    case "tasks.list":
      return humanTasks((result.data as unknown as { tasks: WorkspaceCliTaskSummary[] }).tasks);
    case "capabilities.list":
      return humanCapabilities((result.data as unknown as { capabilities: WorkspaceCliCapabilitySummary[] }).capabilities);
    default:
      return `${options.productName ?? "Workspace"}\n`;
  }
}

function contextJson(value: WorkspaceCliContextSnapshot): WorkspaceCliJson {
  return {
    cwd: value.cwd,
    space: value.space ? spaceJson(value.space) : null,
    selectedPath: value.selectedPath ?? null,
    activeSurface: value.activeSurface ?? null,
  };
}

function spacesJson(values: WorkspaceCliSpaceSummary[]): WorkspaceCliJson {
  return { spaces: values.map(spaceJson), total: values.length };
}

function tasksJson(values: WorkspaceCliTaskSummary[]): WorkspaceCliJson {
  return {
    tasks: values.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      workspaceId: item.workspaceId ?? null,
      updatedAt: item.updatedAt ?? null,
    })),
    total: values.length,
  };
}

function capabilitiesJson(values: WorkspaceCliCapabilitySummary[]): WorkspaceCliJson {
  return {
    capabilities: values.map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      scope: item.scope,
      status: item.status ?? null,
      source: item.source ?? null,
    })),
    total: values.length,
  };
}

function spaceJson(value: WorkspaceCliSpaceSummary): WorkspaceCliJson {
  return {
    id: value.id,
    name: value.name,
    rootPath: value.rootPath ?? null,
    active: value.active ?? false,
  };
}

function humanContext(value: WorkspaceCliContextSnapshot): string {
  const lines = [`Working directory: ${terminalText(value.cwd)}`];
  if (value.space) {
    lines.push(`Space: ${terminalText(value.space.name)} [${terminalText(value.space.id)}]`);
    if (value.space.rootPath) lines.push(`Root: ${terminalText(value.space.rootPath)}`);
  } else {
    lines.push("Space: none");
  }
  if (value.selectedPath) lines.push(`Selected: ${terminalText(value.selectedPath)}`);
  if (value.activeSurface) lines.push(`Surface: ${terminalText(value.activeSurface)}`);
  return `${lines.join("\n")}\n`;
}

function humanSpaces(values: WorkspaceCliSpaceSummary[]): string {
  if (!values.length) return "No Spaces found.\n";
  return `${values.map((item) => `- ${terminalText(item.name)} [${terminalText(item.id)}]${item.rootPath ? ` — ${terminalText(item.rootPath)}` : ""}${item.active ? " (active)" : ""}`).join("\n")}\n`;
}

function humanTasks(values: WorkspaceCliTaskSummary[]): string {
  if (!values.length) return "No tasks found.\n";
  return `${values.map((item) => `- ${terminalText(item.label)} [${terminalText(item.status)}] (${terminalText(item.id)})${item.workspaceId ? ` — Space ${terminalText(item.workspaceId)}` : ""}`).join("\n")}\n`;
}

function humanCapabilities(values: WorkspaceCliCapabilitySummary[]): string {
  if (!values.length) return "No capabilities found.\n";
  return `${values.map((item) => `- ${terminalText(item.name)} [${terminalText(item.kind)}, ${terminalText(item.scope)}${item.status ? `, ${terminalText(item.status)}` : ""}]${item.source ? ` — ${terminalText(item.source)}` : ""}`).join("\n")}\n`;
}

function terminalText(value: unknown): string {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "�");
}

function humanErrorMessage(error: WorkspaceCliError): string {
  const usageHint = "\nRun 'workspace help' for usage.";
  if (error.code === "usage" && error.message.endsWith(usageHint)) {
    return `${terminalText(error.message.slice(0, -usageHint.length))}${usageHint}`;
  }
  return terminalText(error.message);
}

function normalizeSpaceSelector(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f]/.test(normalized)) {
    throw usageError("--space requires a valid Space id or name.");
  }
  return normalized;
}

function usageError(message: string): WorkspaceCliError {
  return new WorkspaceCliError("usage", `${message}\nRun 'workspace help' for usage.`);
}

function normalizeCommandError(error: unknown): WorkspaceCliError {
  if (error instanceof WorkspaceCliError) return error;
  return new WorkspaceCliError("failure", error instanceof Error ? error.message : String(error ?? "Workspace command failed."), { cause: error });
}
