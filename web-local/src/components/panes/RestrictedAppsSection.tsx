import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Add16Regular,
  Alert20Regular,
  ArrowSync16Regular,
  Delete16Regular,
  Dismiss20Regular,
  Info20Regular,
  PlugConnected20Regular,
  ShieldCheckmark20Regular,
} from "@fluentui/react-icons";

import { useModalDialog } from "../../hooks/useModalDialog";
import { errorText } from "../../lib/api";
import {
  deleteRestrictedAppConnection,
  clearRestrictedAppStorage,
  connectRestrictedAppOAuth,
  getRestrictedAppStorageUsage,
  inspectRestrictedApp,
  installRestrictedApp,
  listRestrictedAppConnections,
  removeRestrictedApp,
  runRestrictedAppBackgroundNow,
  setRestrictedAppBackgroundEnabled,
  setRestrictedAppConnection,
  setRestrictedAppFileGrant,
  setRestrictedAppNetworkGrant,
  setRestrictedAppNotificationGrant,
} from "../../lib/restricted-apps";
import type {
  RestrictedAppAuthDeclaration,
  RestrictedAppConnectionStatus,
  RestrictedAppCredential,
  RestrictedAppFilePermission,
  RestrictedAppInstalled,
  RestrictedAppNetworkDestination,
  RestrictedAppNotificationPermission,
  RestrictedAppReview,
  RestrictedAppStorageUsage,
  WorkspaceSummary,
} from "../../types";
import { requestConfirm, showToast } from "../../ui/feedback";

export function RestrictedAppsSection({
  workspace,
  apps,
  loading,
  fixtureMode = false,
  onBuildApp,
  onUpsertApp,
  onRemoveApp,
  onError,
}: {
  workspace: WorkspaceSummary;
  apps: RestrictedAppInstalled[];
  loading: boolean;
  fixtureMode?: boolean;
  onBuildApp: () => void;
  onUpsertApp: (app: RestrictedAppInstalled) => void;
  onRemoveApp: (appId: string) => void;
  onError: (message: string | null) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourcePath, setSourcePath] = useState("");
  const [review, setReview] = useState<{ sourcePath: string; value: RestrictedAppReview } | null>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workspaceIdRef = useRef(workspace.id);
  workspaceIdRef.current = workspace.id;
  const selectedApp = selectedAppId ? apps.find((app) => app.manifest.id === selectedAppId) ?? null : null;

  useEffect(() => {
    setSourceOpen(false);
    setSourcePath("");
    setReview(null);
    setSelectedAppId(null);
    setBusy(false);
  }, [workspace.id]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = sourcePath.trim();
    if (!path) return;
    const workspaceId = workspace.id;
    setBusy(true);
    try {
      const value = fixtureMode ? fixtureReview() : await inspectRestrictedApp(workspaceId, path);
      if (workspaceIdRef.current !== workspaceId) return;
      setSourceOpen(false);
      setReview({ sourcePath: path, value });
    } catch (caught) {
      if (workspaceIdRef.current === workspaceId) onError(errorText(caught));
    } finally {
      if (workspaceIdRef.current === workspaceId) setBusy(false);
    }
  }

  async function install() {
    if (!review) return;
    const workspaceId = workspace.id;
    setBusy(true);
    try {
      const app = fixtureMode
        ? fixtureInstalled(workspaceId, review.value)
        : await installRestrictedApp(workspaceId, review.sourcePath, review.value.digest);
      if (workspaceIdRef.current !== workspaceId) return;
      onUpsertApp(app);
      setReview(null);
      setSourcePath("");
      setSelectedAppId(app.manifest.id);
      showToast({ text: `${app.manifest.title} installed with network, file, notification, and background access off.`, tone: "success" });
    } catch (caught) {
      if (workspaceIdRef.current === workspaceId) onError(errorText(caught));
    } finally {
      if (workspaceIdRef.current === workspaceId) setBusy(false);
    }
  }

  async function remove(app: RestrictedAppInstalled) {
    const confirmed = await requestConfirm({
      title: `Remove ${app.manifest.title}?`,
      body: "Workspace will stop the sandboxed app and remove its installed snapshot, saved credentials, grants, schedules, and local app data. Files in the Space are left unchanged.",
      confirmLabel: "Remove app",
      tone: "danger",
    });
    if (!confirmed || workspaceIdRef.current !== app.workspaceId) return;
    setBusy(true);
    try {
      if (!fixtureMode) await removeRestrictedApp(app.workspaceId, app.manifest.id, app.digest);
      if (workspaceIdRef.current !== app.workspaceId) return;
      onRemoveApp(app.manifest.id);
      setSelectedAppId(null);
      showToast({ text: `${app.manifest.title} removed.`, tone: "success" });
    } catch (caught) {
      if (workspaceIdRef.current === app.workspaceId) onError(errorText(caught));
    } finally {
      if (workspaceIdRef.current === app.workspaceId) setBusy(false);
    }
  }

  return (
    <section className="restricted-apps-section capabilities-management-section" aria-labelledby="restricted-apps-title">
      <div className="restricted-apps-heading">
        <div>
          <span className="professional-icon-tile" aria-hidden="true"><ShieldCheckmark20Regular /></span>
          <div><h3 id="restricted-apps-title">Apps in this Space</h3><p>Apps the Assistant creates can add an interactive navigator, persistent work tabs, and connected actions. Each runs in Workspace’s restricted browser; you decide what it may connect to.</p></div>
        </div>
        {apps.length ? <button className="professional-button professional-button-primary" type="button" disabled={busy} onClick={onBuildApp}><Add16Regular />Build with Assistant</button> : null}
      </div>
      <p className="restricted-apps-note"><Info20Regular aria-hidden="true" />Installing gives an app bounded local storage, but no network, Space-file, notification, or background access. You approve those powers separately.</p>
      {loading && !apps.length ? <div className="restricted-apps-loading"><ArrowSync16Regular className="spin" />Loading sandboxed apps</div> : null}
      {apps.length ? (
        <div className="restricted-app-list">
          {apps.map((app) => (
            <article className="restricted-app-card" key={`${app.manifest.id}:${app.digest}`}>
              <div className="restricted-app-card-copy">
                <div className="restricted-app-card-title"><strong>{app.manifest.title}</strong><span>Extension · Sandboxed app</span></div>
                <p>{app.manifest.description || "A Space-bound app running in Workspace's restricted browser runtime."}</p>
                <div className="restricted-app-card-meta"><span>This Space</span><span>{app.packageName} {app.version}</span><span>Interactive app UI</span></div>
                <small>{app.manifest.tools.length} {app.manifest.tools.length === 1 ? "action" : "actions"} · {app.networkGrants.length}/{app.manifest.permissions.network.length} network · {app.fileGrants.length}/{app.manifest.permissions.files.length} files · {app.notificationGrants.length}/{app.manifest.permissions.notifications.length} notifications{app.manifest.background ? ` · background ${app.backgroundEnabled ? "on" : "off"}` : ""}</small>
              </div>
              <div className="restricted-app-card-actions"><span className="professional-status-badge enabled">Restricted runtime</span><button className="professional-button professional-button-secondary" type="button" onClick={() => setSelectedAppId(app.manifest.id)}>{app.manifest.permissions.network.length || app.manifest.permissions.files.length || app.manifest.permissions.notifications.length || app.manifest.background ? "Manage access" : "Manage"}</button></div>
            </article>
          ))}
        </div>
      ) : !loading ? <div className="restricted-app-empty"><strong>Build something for this Space</strong><span>Ask the Assistant for an inbox, dashboard, tracker, or connection. It will create the package here and bring the exact revision back for review.</span><button className="professional-button professional-button-primary" type="button" onClick={onBuildApp}><Add16Regular />Build with Assistant</button></div> : null}
      <details className="restricted-app-advanced"><summary>Advanced local install</summary><p>Review a restricted app package folder that already exists in this Space.</p><button className="professional-button professional-button-secondary" type="button" disabled={busy} onClick={() => setSourceOpen(true)}>Install local package…</button></details>

      {sourceOpen ? <RestrictedAppSourceDialog sourcePath={sourcePath} busy={busy} onSourcePathChange={setSourcePath} onSubmit={inspect} onClose={() => { if (!busy) setSourceOpen(false); }} /> : null}
      {review ? <RestrictedAppReviewDialog review={review.value} sourcePath={review.sourcePath} updating={apps.some((app) => app.manifest.id === review.value.manifest.id)} busy={busy} onInstall={() => void install()} onClose={() => { if (!busy) setReview(null); }} /> : null}
      {selectedApp ? <RestrictedAppDetailsDialog app={selectedApp} busy={busy} fixtureMode={fixtureMode} onAppChanged={onUpsertApp} onRemove={() => void remove(selectedApp)} onError={onError} onClose={() => { if (!busy) setSelectedAppId(null); }} /> : null}
    </section>
  );
}

function RestrictedAppSourceDialog({ sourcePath, busy, onSourcePathChange, onSubmit, onClose }: {
  sourcePath: string;
  busy: boolean;
  onSourcePathChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useModalDialog({ onClose, blocked: busy, initialFocusRef: inputRef });
  return <div className="modal-backdrop capability-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="capability-dialog restricted-app-source-dialog" role="dialog" aria-modal="true" aria-labelledby="restricted-app-source-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-title"><div><h2 id="restricted-app-source-title">Install local app package</h2><p>Enter a package folder that already exists inside this Space.</p></div><button className="minimal-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close local app install"><Dismiss20Regular /></button></div>
      <form onSubmit={onSubmit}>
        <div className="capability-dialog-body restricted-app-source-body">
          <label><strong>Package path</strong><span>Enter a path relative to the root of this Space. Workspace inspects it without running package code.</span><input ref={inputRef} value={sourcePath} onChange={(event) => onSourcePathChange(event.target.value)} placeholder="apps/connected-inbox" aria-label="Space-relative app package folder" autoComplete="off" spellCheck={false} /></label>
          <aside className="capability-code-warning"><ShieldCheckmark20Regular aria-hidden="true" /><div><strong>Fixed to This Space</strong><p>Sandboxed apps are installed for this Space only. Their receipts, permissions, and credentials stay machine-local.</p></div></aside>
        </div>
        <div className="capability-dialog-footer"><button className="professional-button professional-button-secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="professional-button professional-button-primary" type="submit" disabled={busy || !sourcePath.trim()}>{busy ? <ArrowSync16Regular className="spin" /> : null}Review app</button></div>
      </form>
    </section>
  </div>;
}

export function RestrictedAppReviewDialog({ review, sourcePath, updating, busy, installDisabled = false, installLabel, closeLabel = "Not now", onInstall, onClose }: {
  review: RestrictedAppReview;
  sourcePath: string;
  updating: boolean;
  busy: boolean;
  installDisabled?: boolean;
  installLabel?: string;
  closeLabel?: string;
  onInstall: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog({ onClose, blocked: busy, initialFocusRef: cancelRef });
  return <div className="modal-backdrop capability-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="capability-dialog restricted-app-review-dialog" role="dialog" aria-modal="true" aria-labelledby="restricted-app-review-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-title"><div><h2 id="restricted-app-review-title">Review {review.manifest.title}</h2><p>Workspace inspected this exact revision without executing it.</p></div><button className="minimal-icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Close app review"><Dismiss20Regular /></button></div>
      <div className="capability-dialog-body">
        <ReviewDeclarations review={review} />
        <details className="restricted-app-package-details"><summary>Package details</summary><dl className="capability-review-facts"><div><dt>Source</dt><dd>{sourcePath}</dd></div><div><dt>Package</dt><dd>{review.packageName} {review.version}</dd></div><div><dt>Files</dt><dd>{review.fileCount} · {formatBytes(review.totalBytes)}</dd></div><div><dt>Browser entry</dt><dd>{review.manifest.runtime.entry}</dd></div><div><dt>Reviewed revision</dt><dd><code>{shortDigest(review.digest)}</code></dd></div></dl></details>
        <aside className="capability-code-warning"><ShieldCheckmark20Regular aria-hidden="true" /><div><strong>Browser code runs in a restricted renderer</strong><p>It has no direct Node, filesystem, process, or network access. Installing grants no network destinations, Space files, notifications, or background execution; you approve those later in app details.</p></div></aside>
        {updating ? <aside className="capability-code-warning danger"><Info20Regular aria-hidden="true" /><div><strong>This replaces the installed revision</strong><p>The updated app starts with network and notification permissions off and must have its access approved again.</p></div></aside> : null}
        {installDisabled && !busy ? <p className="restricted-app-install-wait">Finish the current Assistant turn before installing this reviewed revision.</p> : null}
      </div>
      <div className="capability-dialog-footer"><button ref={cancelRef} className="professional-button professional-button-secondary" type="button" disabled={busy} onClick={onClose}>{closeLabel}</button><button className="professional-button professional-button-primary" type="button" disabled={busy || installDisabled} onClick={onInstall}>{busy ? <ArrowSync16Regular className="spin" /> : null}{installLabel ?? (updating ? "Review update" : "Install, then review access")}</button></div>
    </section>
  </div>;
}

function ReviewDeclarations({ review }: { review: RestrictedAppReview }) {
  return <div className="restricted-app-review-groups">
    <section><h3>Requested access</h3>{review.manifest.permissions.network.length ? <div>{review.manifest.permissions.network.map((destination) => <article key={destination.id}><strong>{destinationLabel(destination)}</strong><span>{destination.methods.join(", ")}</span><small>{destination.auth.map(authLabel).join(" · ")}</small></article>)}</div> : <p>No network access requested.</p>}{review.manifest.permissions.files.length ? <div>{review.manifest.permissions.files.map((permission) => <article key={permission.id}><strong>{permission.access === "read-write" ? "Read and write" : "Read"} a {permission.target} you choose</strong><span>{permission.id}</span></article>)}</div> : <p>No Space files requested.</p>}{review.manifest.permissions.notifications.length ? <div>{review.manifest.permissions.notifications.map((permission) => <article key={permission.id}><strong>Workspace · {review.manifest.title} — {permission.title}</strong><span>{permission.description}</span><small>Static Windows notification · {permission.id}</small></article>)}</div> : <p>No notifications requested.</p>}{review.manifest.background ? <p>May run its sandboxed worker every {review.manifest.background.intervalMinutes} minutes after you enable it.</p> : <p>No background work requested.</p>}</section>
    <section><h3>What it adds</h3><p>Adds an interactive app destination to this Space’s rail. The app can open, update, and close Space-owned work tabs through Workspace.</p>{review.manifest.tools.length ? <div>{review.manifest.tools.map((tool) => <article key={tool.name}><strong>{tool.name}</strong><span>{tool.description}</span><code>{tool.action}</code></article>)}</div> : <p>No background Assistant actions.</p>}</section>
  </div>;
}

function RestrictedAppDetailsDialog({ app, busy, fixtureMode, onAppChanged, onRemove, onError, onClose }: {
  app: RestrictedAppInstalled;
  busy: boolean;
  fixtureMode: boolean;
  onAppChanged: (app: RestrictedAppInstalled) => void;
  onRemove: () => void;
  onError: (message: string | null) => void;
  onClose: () => void;
}) {
  const [connections, setConnections] = useState<RestrictedAppConnectionStatus[]>([]);
  const [storageUsage, setStorageUsage] = useState<RestrictedAppStorageUsage | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const dialogRef = useModalDialog({ onClose, blocked: busy || Boolean(actionBusy) });

  useEffect(() => {
    let cancelled = false;
    setConnections([]);
    setConnectionLoading(true);
    const load = fixtureMode
      ? Promise.resolve(app.manifest.permissions.network.map((destination) => ({ destinationId: destination.id, kind: destination.auth.some((auth) => auth.kind === "none") ? "none" as const : null, configured: destination.auth.some((auth) => auth.kind === "none") })))
      : listRestrictedAppConnections(app.workspaceId, app.manifest.id, app.digest);
    void load.then((value) => { if (!cancelled) setConnections(value); }).catch((caught) => { if (!cancelled) onError(errorText(caught)); }).finally(() => { if (!cancelled) setConnectionLoading(false); });
    const storage = fixtureMode
      ? Promise.resolve({ revision: 0, usageBytes: 0, quotaBytes: 5 * 1024 * 1024, keyCount: 0, keyLimit: 512 })
      : getRestrictedAppStorageUsage(app.workspaceId, app.manifest.id, app.digest);
    void storage.then((value) => { if (!cancelled) setStorageUsage(value); }).catch((caught) => { if (!cancelled) onError(errorText(caught)); });
    return () => { cancelled = true; };
  }, [app.digest, app.manifest.id, app.workspaceId, fixtureMode, onError]);

  async function changeGrant(destination: RestrictedAppNetworkDestination, granted: boolean) {
    if (granted) {
      const confirmed = await requestConfirm({
        title: `Allow network access to ${destinationLabel(destination)}?`,
        body: destination.target.kind === "loopback-http"
          ? `${app.manifest.title} will be able to use ${destination.methods.join(", ")} requests to this exact loopback address. Workspace verifies the address, but does not yet verify which local process owns the port.`
          : `${app.manifest.title} will be able to use ${destination.methods.join(", ")} requests to this exact origin through Workspace's network broker.`,
        confirmLabel: "Allow access",
      });
      if (!confirmed) return;
    }
    const key = `grant:${destination.id}`;
    setActionBusy(key);
    try {
      const updated = fixtureMode ? { ...app, networkGrants: granted ? [...new Set([...app.networkGrants, destination.id])] : app.networkGrants.filter((id) => id !== destination.id) } : await setRestrictedAppNetworkGrant(app.workspaceId, app.manifest.id, destination.id, app.digest, granted);
      onAppChanged(updated);
      showToast({ text: granted ? `Network access allowed for ${destinationLabel(destination)}.` : `Network access revoked for ${destinationLabel(destination)}; any saved credential remains.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function saveCredential(destination: RestrictedAppNetworkDestination, credential: RestrictedAppCredential) {
    const key = `credential:${destination.id}`;
    setActionBusy(key);
    try {
      const status = fixtureMode ? { destinationId: destination.id, kind: credential.kind, configured: true } as RestrictedAppConnectionStatus : await setRestrictedAppConnection(app.workspaceId, app.manifest.id, destination.id, app.digest, credential);
      setConnections((current) => upsertConnectionStatus(current, status));
      showToast({ text: `Connection saved for ${destinationLabel(destination)}. Access is ${app.networkGrants.includes(destination.id) ? "allowed" : "still off"}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); throw caught; }
    finally { setActionBusy(null); }
  }

  async function disconnect(destination: RestrictedAppNetworkDestination) {
    const confirmed = await requestConfirm({ title: `Disconnect ${destinationLabel(destination)}?`, body: "Workspace will remove the saved sign-in. The separate access permission will not change.", confirmLabel: "Disconnect", tone: "danger" });
    if (!confirmed) return;
    const key = `credential:${destination.id}`;
    setActionBusy(key);
    try {
      if (!fixtureMode) await deleteRestrictedAppConnection(app.workspaceId, app.manifest.id, destination.id, app.digest);
      const anonymous = destination.auth.some((auth) => auth.kind === "none");
      setConnections((current) => upsertConnectionStatus(current, { destinationId: destination.id, kind: anonymous ? "none" : null, configured: anonymous }));
      showToast({ text: `Disconnected ${destinationLabel(destination)}. Access is ${app.networkGrants.includes(destination.id) ? "still allowed" : "off"}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function connectOAuth(destination: RestrictedAppNetworkDestination) {
    setActionBusy(`oauth:${destination.id}`);
    try {
      const status = fixtureMode
        ? { destinationId: destination.id, kind: "oauth2-pkce" as const, configured: true }
        : await connectRestrictedAppOAuth(app.workspaceId, app.manifest.id, destination.id, app.digest);
      setConnections((current) => upsertConnectionStatus(current, status));
      showToast({ text: `Browser sign-in connected for ${destinationLabel(destination)}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function changeFileGrant(permission: RestrictedAppFilePermission, root: string, granted: boolean) {
    if (granted) {
      const confirmed = await requestConfirm({
        title: `Allow ${permission.access === "read-write" ? "changes to" : "reading"} ${root}?`,
        body: `${app.manifest.title} will be limited to this ${permission.target} inside the Space. Workspace metadata, Pi configuration, links, and paths outside the Space remain blocked.`,
        confirmLabel: "Allow file access",
      });
      if (!confirmed) return;
    }
    setActionBusy(`file:${permission.id}`);
    try {
      const updated = fixtureMode
        ? { ...app, fileGrants: granted ? [{ id: permission.id, declarationId: permission.id, root, access: permission.access }] : app.fileGrants.filter((grant) => grant.declarationId !== permission.id) }
        : await setRestrictedAppFileGrant(app.workspaceId, app.manifest.id, permission.id, app.digest, granted, root);
      onAppChanged(updated);
      showToast({ text: granted ? `File access allowed for ${root}.` : `File access revoked for ${permission.id}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function changeNotificationGrant(permission: RestrictedAppNotificationPermission, granted: boolean) {
    if (granted) {
      const confirmed = await requestConfirm({
        title: `Allow “${permission.title}” notifications?`,
        body: `${app.manifest.title} may show this exact notification only during enabled background work while Workspace is running.\n\nTitle: Workspace · ${app.manifest.title} — ${permission.title}\nBody: ${permission.description}`,
        confirmLabel: "Allow notifications",
      });
      if (!confirmed) return;
    }
    setActionBusy(`notification:${permission.id}`);
    try {
      const updated = fixtureMode
        ? { ...app, notificationGrants: granted ? [...new Set([...app.notificationGrants, permission.id])] : app.notificationGrants.filter((id) => id !== permission.id) }
        : await setRestrictedAppNotificationGrant(app.workspaceId, app.manifest.id, permission.id, app.digest, granted);
      onAppChanged(updated);
      showToast({ text: granted ? `Notifications allowed for ${permission.title}.` : `Notifications revoked for ${permission.title}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function changeBackground(enabled: boolean) {
    if (enabled) {
      const confirmed = await requestConfirm({
        title: `Allow ${app.manifest.title} to run in the background?`,
        body: `Its sandboxed worker may run about every ${app.manifest.background?.intervalMinutes} minutes while Workspace is running. It can use only currently granted connections and files.`,
        confirmLabel: "Enable background work",
      });
      if (!confirmed) return;
    }
    setActionBusy("background");
    try {
      const updated = fixtureMode ? { ...app, backgroundEnabled: enabled } : await setRestrictedAppBackgroundEnabled(app.workspaceId, app.manifest.id, app.digest, enabled);
      onAppChanged(updated);
      showToast({ text: `Background work ${enabled ? "enabled" : "disabled"}.`, tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function runBackground() {
    setActionBusy("background-run");
    try {
      const updated = fixtureMode ? { ...app, backgroundLastRunAt: new Date().toISOString(), backgroundLastError: undefined } : await runRestrictedAppBackgroundNow(app.workspaceId, app.manifest.id, app.digest);
      onAppChanged(updated);
      showToast({ text: "Background work completed.", tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  async function clearStorage() {
    const confirmed = await requestConfirm({ title: `Clear ${app.manifest.title} app data?`, body: "This removes its machine-local settings and cached state. Connections and Space files are not changed.", confirmLabel: "Clear app data", tone: "danger" });
    if (!confirmed) return;
    setActionBusy("storage");
    try {
      const usage = fixtureMode ? { revision: (storageUsage?.revision ?? 0) + 1, usageBytes: 0, quotaBytes: 5 * 1024 * 1024, keyCount: 0, keyLimit: 512 } : await clearRestrictedAppStorage(app.workspaceId, app.manifest.id, app.digest);
      setStorageUsage(usage);
      showToast({ text: "Local app data cleared.", tone: "success" });
    } catch (caught) { onError(errorText(caught)); }
    finally { setActionBusy(null); }
  }

  return <div className="modal-backdrop capability-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section ref={dialogRef} tabIndex={-1} className="capability-dialog restricted-app-details-dialog" role="dialog" aria-modal="true" aria-labelledby="restricted-app-details-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-title"><div><h2 id="restricted-app-details-title">{app.manifest.title}</h2><p>App · This Space · Restricted runtime</p></div><button className="minimal-icon-button" type="button" disabled={busy || Boolean(actionBusy)} onClick={onClose} aria-label="Close app details"><Dismiss20Regular /></button></div>
      <div className="capability-dialog-body">
        <p className="capability-details-summary">{app.manifest.description}</p>
        <section className="restricted-app-connections" aria-labelledby="restricted-app-connections-title">
          <div className="restricted-app-connections-heading"><div><PlugConnected20Regular aria-hidden="true" /><h3 id="restricted-app-connections-title">Access & connections</h3></div>{connectionLoading ? <span><ArrowSync16Regular className="spin" />Checking</span> : null}</div>
          {!app.manifest.permissions.network.length ? <p>This app declares no network destinations.</p> : app.manifest.permissions.network.map((destination) => {
            const status = connections.find((item) => item.destinationId === destination.id);
            const granted = app.networkGrants.includes(destination.id);
            return <DestinationCard
              key={destination.id}
              destination={destination}
              granted={granted}
              status={status}
              loading={connectionLoading}
              busy={Boolean(actionBusy)}
              activeBusyKey={actionBusy}
              onGrantChange={(next) => void changeGrant(destination, next)}
              onSave={(credential) => saveCredential(destination, credential)}
              onOAuth={() => void connectOAuth(destination)}
              onDisconnect={() => void disconnect(destination)}
            />;
          })}
        </section>
        <section className="restricted-app-connections" aria-labelledby="restricted-app-files-title">
          <div className="restricted-app-connections-heading"><div><ShieldCheckmark20Regular aria-hidden="true" /><h3 id="restricted-app-files-title">Space files</h3></div></div>
          {!app.manifest.permissions.files.length ? <p>This app requests no Space files.</p> : app.manifest.permissions.files.map((permission) => <FilePermissionCard
            key={permission.id}
            permission={permission}
            grant={app.fileGrants.find((item) => item.declarationId === permission.id)}
            busy={Boolean(actionBusy)}
            active={actionBusy === `file:${permission.id}`}
            onChange={(root, granted) => void changeFileGrant(permission, root, granted)}
          />)}
        </section>
        <section className="restricted-app-connections" aria-labelledby="restricted-app-notifications-title">
          <div className="restricted-app-connections-heading"><div><Alert20Regular aria-hidden="true" /><h3 id="restricted-app-notifications-title">Windows notifications</h3></div></div>
          {!app.manifest.permissions.notifications.length ? <p>This app declares no notifications.</p> : app.manifest.permissions.notifications.map((permission) => {
            const granted = app.notificationGrants.includes(permission.id);
            return <article className="restricted-app-destination-card" key={permission.id}>
              <div className="restricted-app-destination-heading"><div><strong>Workspace · {app.manifest.title} — {permission.title}</strong><span>{permission.description}</span></div><code>{permission.id}</code></div>
              <div className="restricted-app-destination-states"><span className={granted ? "enabled" : ""}>Access: <strong>{granted ? "Allowed" : "Off"}</strong></span><span>Copy: <strong>Fixed to this reviewed revision</strong></span></div>
              <div className="restricted-app-destination-actions"><button className={granted ? "professional-button professional-button-secondary" : "professional-button professional-button-primary"} type="button" disabled={Boolean(actionBusy)} onClick={() => void changeNotificationGrant(permission, !granted)}>{actionBusy === `notification:${permission.id}` ? <ArrowSync16Regular className="spin" /> : null}{granted ? "Revoke notifications" : "Allow notifications"}</button></div>
              <p className="restricted-app-oauth-note">Shown only from enabled background work while Workspace is running. Windows notification settings can still suppress it. Clicking opens this app in its owning Space.</p>
            </article>;
          })}
        </section>
        {app.manifest.background ? <section className="restricted-app-lifecycle"><div><h3>Background work</h3><p>Every {app.manifest.background.intervalMinutes} minutes while Workspace is running · {app.backgroundLastRunAt ? `Last ran ${formatTimestamp(app.backgroundLastRunAt)}` : "Not run yet"}{app.backgroundLastError ? ` · Last error: ${app.backgroundLastError}` : ""}</p></div><div className="restricted-app-destination-actions"><button className="professional-button professional-button-secondary" type="button" disabled={Boolean(actionBusy) || !app.backgroundEnabled} onClick={() => void runBackground()}>{actionBusy === "background-run" ? <ArrowSync16Regular className="spin" /> : null}Run now</button><button className={app.backgroundEnabled ? "professional-button professional-button-secondary" : "professional-button professional-button-primary"} type="button" disabled={Boolean(actionBusy)} onClick={() => void changeBackground(!app.backgroundEnabled)}>{actionBusy === "background" ? <ArrowSync16Regular className="spin" /> : null}{app.backgroundEnabled ? "Disable" : "Enable"}</button></div></section> : null}
        <section className="restricted-app-lifecycle"><div><h3>Local app data</h3><p>{storageUsage ? `${formatBytes(storageUsage.usageBytes)} of ${formatBytes(storageUsage.quotaBytes)} · ${storageUsage.keyCount} of ${storageUsage.keyLimit} keys` : "Checking usage…"} · Machine-local and preserved across app updates</p></div><button className="professional-button professional-button-secondary" type="button" disabled={Boolean(actionBusy) || !storageUsage?.keyCount} onClick={() => void clearStorage()}>{actionBusy === "storage" ? <ArrowSync16Regular className="spin" /> : null}Clear data</button></section>
        <details className="restricted-app-package-details"><summary>Package & runtime</summary><dl className="capability-review-facts"><div><dt>Package</dt><dd>{app.packageName} {app.version}</dd></div><div><dt>Installed revision</dt><dd><code>{shortDigest(app.digest)}</code></dd></div><div><dt>Runtime</dt><dd>Sandboxed web app</dd></div><div><dt>UI entry</dt><dd>{app.manifest.runtime.entry}</dd></div><div><dt>Worker</dt><dd>{app.manifest.runtime.worker ?? "None"}</dd></div></dl></details>
        <section className="restricted-app-lifecycle"><div><h3>Lifecycle</h3><p>Installed {formatTimestamp(app.installedAt)} · Updated {formatTimestamp(app.updatedAt)}</p></div><button className="professional-button professional-button-danger" type="button" disabled={busy || Boolean(actionBusy)} onClick={onRemove}><Delete16Regular />Remove app</button></section>
      </div>
      <div className="capability-dialog-footer restricted-app-details-footer"><button className="professional-button professional-button-primary" type="button" disabled={busy || Boolean(actionBusy)} onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

function FilePermissionCard({ permission, grant, busy, active, onChange }: {
  permission: RestrictedAppFilePermission;
  grant?: RestrictedAppInstalled["fileGrants"][number];
  busy: boolean;
  active: boolean;
  onChange: (root: string, granted: boolean) => void;
}) {
  const [root, setRoot] = useState(grant?.root ?? "");
  useEffect(() => setRoot(grant?.root ?? ""), [grant?.root, permission.target]);
  return <article className="restricted-app-destination-card">
    <div className="restricted-app-destination-heading"><div><strong>{permission.access === "read-write" ? "Read and write" : "Read"} one {permission.target}</strong><span>{grant ? `Granted: ${grant.root}` : "Choose a path inside this Space"}</span></div><code>{permission.id}</code></div>
    <div className="restricted-app-credential-fields"><label><span>Space-relative path</span><input value={root} disabled={busy || Boolean(grant)} onChange={(event) => setRoot(event.target.value)} placeholder={permission.target === "directory" ? "data (or . for the whole Space)" : "data/report.json"} /></label></div>
    <div className="restricted-app-destination-actions"><button className={grant ? "professional-button professional-button-secondary" : "professional-button professional-button-primary"} type="button" disabled={busy || (!grant && !root.trim())} onClick={() => onChange(grant?.root ?? root.trim(), !grant)}>{active ? <ArrowSync16Regular className="spin" /> : null}{grant ? "Revoke access" : "Allow access"}</button></div>
    <p className="restricted-app-oauth-note">Links, Workspace metadata, Pi configuration, and paths outside this Space are always blocked. App writes create History checkpoints.</p>
  </article>;
}

function DestinationCard({ destination, granted, status, loading, busy, activeBusyKey, onGrantChange, onSave, onOAuth, onDisconnect }: {
  destination: RestrictedAppNetworkDestination;
  granted: boolean;
  status?: RestrictedAppConnectionStatus;
  loading: boolean;
  busy: boolean;
  activeBusyKey: string | null;
  onGrantChange: (granted: boolean) => void;
  onSave: (credential: RestrictedAppCredential) => Promise<void>;
  onOAuth: () => void;
  onDisconnect: () => void;
}) {
  const supportedAuth = destination.auth.filter(isSupportedAuth);
  const oauth = destination.auth.find((auth) => auth.kind === "oauth2-pkce");
  const requiresCredential = !destination.auth.some((auth) => auth.kind === "none");
  const unsupportedOnly = requiresCredential && !supportedAuth.length && !oauth;
  return <article className="restricted-app-destination-card">
    <div className="restricted-app-destination-heading"><div><strong>{destinationLabel(destination)}</strong><span>{destination.methods.join(" · ")}</span></div><code>{destination.id}</code></div>
    <div className="restricted-app-destination-states"><span className={granted ? "enabled" : ""}>Access: <strong>{granted ? "Allowed" : "Off"}</strong></span><span className={status?.configured ? "enabled" : ""}>Connection: <strong>{loading ? "Checking…" : connectionLabel(destination, status, unsupportedOnly)}</strong></span></div>
    <div className="restricted-app-destination-actions"><button className={granted ? "professional-button professional-button-secondary" : "professional-button professional-button-primary"} type="button" disabled={busy || loading} onClick={() => onGrantChange(!granted)}>{activeBusyKey === `grant:${destination.id}` ? <ArrowSync16Regular className="spin" /> : null}{granted ? "Revoke access" : "Allow access"}</button>{!loading && oauth ? <button className="professional-button professional-button-secondary" type="button" disabled={busy} onClick={onOAuth}>{activeBusyKey === `oauth:${destination.id}` ? <ArrowSync16Regular className="spin" /> : null}{status?.kind === "oauth2-pkce" ? "Reconnect in browser" : "Connect in browser"}</button> : null}{!loading && status?.configured && status.kind !== "none" ? <button className="professional-button professional-button-secondary" type="button" disabled={busy} onClick={onDisconnect}>{activeBusyKey === `credential:${destination.id}` || activeBusyKey === `oauth:${destination.id}` ? <ArrowSync16Regular className="spin" /> : null}Disconnect</button> : null}</div>
    {!loading && supportedAuth.length ? <details className="restricted-app-connect-details"><summary>{status?.configured ? "Replace connection" : "Connect"}</summary><CredentialForm destination={destination} supportedAuth={supportedAuth} configuredKind={status?.kind} busy={busy} onSave={onSave} /></details> : null}
    {oauth ? <p className="restricted-app-oauth-note">Uses the system browser with PKCE. The package supplies a public native-client ID; Workspace keeps callback state and tokens in the encrypted host.</p> : null}
    {unsupportedOnly ? <p className="restricted-app-oauth-note">{destination.auth.map(authLabel).join(" or ")} is not supported by this Workspace version.</p> : null}
    {destination.target.kind === "loopback-http" ? <p className="restricted-app-oauth-note">Local process ownership is not verified. Allow this only while you recognize the service listening on this port.</p> : null}
  </article>;
}

function CredentialForm({ destination, supportedAuth, configuredKind, busy, onSave }: {
  destination: RestrictedAppNetworkDestination;
  supportedAuth: Array<Extract<RestrictedAppAuthDeclaration, { kind: "api-key" | "bearer" | "basic" }>>;
  configuredKind?: RestrictedAppConnectionStatus["kind"];
  busy: boolean;
  onSave: (credential: RestrictedAppCredential) => Promise<void>;
}) {
  const initialKind = configuredKind && isManualCredentialKind(configuredKind) ? configuredKind : supportedAuth[0]?.kind ?? "api-key";
  const [kind, setKind] = useState<"api-key" | "bearer" | "basic">(() => initialKind);
  const [secret, setSecret] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const selected = supportedAuth.find((auth) => auth.kind === kind) ?? supportedAuth[0];
  useEffect(() => { setKind(initialKind); setSecret(""); setUsername(""); setPassword(""); }, [destination.id, initialKind, supportedAuth.map((auth) => auth.kind).join("|")]);
  if (!selected) return null;
  const ready = kind === "basic" ? Boolean(username.trim() && password) : Boolean(secret);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    const credential: RestrictedAppCredential = kind === "api-key" ? { kind, value: secret } : kind === "bearer" ? { kind, token: secret } : { kind, username: username.trim(), password };
    try {
      await onSave(credential);
      setSecret(""); setUsername(""); setPassword("");
    } catch {
      // The owner reports the host error and retains the entered value so the
      // person can retry without Workspace ever reading a stored secret back.
    }
  }
  return <form className="restricted-app-credential-form" onSubmit={(event) => void submit(event)} autoComplete="off">
    <div className="restricted-app-credential-heading"><strong>{configuredKind ? "Replace connection" : "Connect"}</strong>{supportedAuth.length > 1 ? <label><span className="sr-only">Authentication type</span><select value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setSecret(""); setUsername(""); setPassword(""); }}>{supportedAuth.map((auth) => <option key={auth.kind} value={auth.kind}>{authLabel(auth)}</option>)}</select></label> : <span>{authLabel(selected)}</span>}</div>
    {kind === "basic" ? <div className="restricted-app-credential-fields"><label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" /></label><label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label></div> : <label className="restricted-app-secret-field"><span>{kind === "api-key" ? `API key · ${selected.kind === "api-key" ? selected.header : "manifest header"}` : "Bearer token"}</span><input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" /></label>}
    <div><button className="professional-button professional-button-secondary" type="submit" disabled={busy || !ready}>{configuredKind ? "Replace connection" : "Connect"}</button><small>Saved values are encrypted by the desktop host and are never shown again.</small></div>
  </form>;
}

function isSupportedAuth(auth: RestrictedAppAuthDeclaration): auth is Extract<RestrictedAppAuthDeclaration, { kind: "api-key" | "bearer" | "basic" }> {
  return auth.kind === "api-key" || auth.kind === "bearer" || auth.kind === "basic";
}

function isManualCredentialKind(kind: RestrictedAppConnectionStatus["kind"]): kind is "api-key" | "bearer" | "basic" {
  return kind === "api-key" || kind === "bearer" || kind === "basic";
}

function authLabel(auth: RestrictedAppAuthDeclaration): string {
  if (auth.kind === "api-key") return `API key (${auth.header})`;
  if (auth.kind === "bearer") return "Bearer token";
  if (auth.kind === "basic") return "Username and password";
  if (auth.kind === "none") return "No sign-in";
  return `OAuth browser sign-in (${new URL(auth.issuer).hostname})`;
}

function connectionLabel(destination: RestrictedAppNetworkDestination, status: RestrictedAppConnectionStatus | undefined, unsupportedOnly: boolean): string {
  if (destination.auth.some((auth) => auth.kind === "none")) return "No sign-in required";
  if (status?.configured) {
    if (status.kind === "api-key") return "Connected with API key";
    if (status.kind === "bearer") return "Connected with bearer token";
    if (status.kind === "basic") return "Connected with username and password";
    if (status.kind === "oauth2-pkce") return "Connected with OAuth";
  }
  return unsupportedOnly ? "Sign-in unavailable" : "Not connected";
}

function destinationLabel(destination: RestrictedAppNetworkDestination): string {
  if (destination.target.kind === "public-https") return destination.target.origin;
  return `http://${destination.target.host === "::1" ? "[::1]" : destination.target.host}:${destination.target.port}`;
}

function upsertConnectionStatus(items: RestrictedAppConnectionStatus[], status: RestrictedAppConnectionStatus): RestrictedAppConnectionStatus[] {
  return items.some((item) => item.destinationId === status.destinationId) ? items.map((item) => item.destinationId === status.destinationId ? status : item) : [...items, status];
}

function shortDigest(digest: string): string { return `${digest.slice(0, 12)}…${digest.slice(-8)}`; }
function formatBytes(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function formatTimestamp(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(); }

function fixtureReview(): RestrictedAppReview {
  return {
    packageName: "connected-inbox",
    version: "0.1.0",
    digest: "a".repeat(64),
    fileCount: 4,
    totalBytes: 4096,
    manifest: {
      version: 1,
      id: "connected-inbox",
      title: "Connected inbox",
      description: "Messages associated with this Space.",
      runtime: { kind: "sandboxed-web", entry: "index.html", worker: "worker.js" },
      ui: { icon: "mail" },
      tools: [{ name: "inbox_search", description: "Search messages in the connected inbox.", action: "search", inputSchema: { type: "object" }, resultSchema: { type: "object" } }],
      background: { intervalMinutes: 30 },
      permissions: {
        network: [{ id: "mail-api", target: { kind: "public-https", origin: "https://mail.example.com" }, methods: ["GET"], auth: [{ kind: "api-key", header: "x-api-key" }, { kind: "bearer" }] }],
        files: [{ id: "export-folder", target: "directory", access: "read-write" }],
        notifications: [{ id: "new-messages", title: "New messages", description: "New messages are ready in your connected inbox." }],
      },
    },
  };
}

function fixtureInstalled(workspaceId: string, review: RestrictedAppReview): RestrictedAppInstalled {
  const now = new Date().toISOString();
  return { ...review, workspaceId, networkGrants: [], fileGrants: [], notificationGrants: [], backgroundEnabled: false, installedAt: now, updatedAt: now };
}
