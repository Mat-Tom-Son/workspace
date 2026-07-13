export async function handleAction(action, input) {
  if (action !== "search") throw new Error("Unknown action.");
  const response = await globalThis.workspaceRestrictedApp.request({
    destinationId: "mail-api",
    method: "GET",
    path: `/messages?query=${encodeURIComponent(input.query)}`,
    headers: { accept: "application/json" },
  });
  if (response.status < 200 || response.status >= 300 || response.encoding !== "utf8") {
    throw new Error(`Mail search failed with status ${response.status}.`);
  }
  const data = JSON.parse(response.body);
  return { count: Number.isInteger(data.count) && data.count >= 0 ? data.count : 0 };
}

export async function handleBackground(event) {
  const response = await globalThis.workspaceRestrictedApp.request({
    destinationId: "mail-api",
    method: "GET",
    path: "/messages?limit=20",
    headers: { accept: "application/json" },
  });
  await globalThis.workspaceRestrictedApp.storage.set("last-background-sync", {
    reason: event.reason,
    scheduledAt: event.scheduledAt,
    status: response.status,
  });
  try {
    await globalThis.workspaceRestrictedApp.notifications.show({ permissionId: "new-messages" });
  } catch {
    // Notification access is optional and must not fail the completed sync.
  }
}
