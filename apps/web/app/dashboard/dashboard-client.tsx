"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Organization {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface Repository {
  id: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  url: string | null;
  isPrivate: boolean | null;
  _count: { branches: number; commits: number; files: number };
}

interface Connection {
  id: string;
  provider: string;
  accountLogin: string;
  status: string;
}

interface DashboardData {
  profile: { user: { email: string } };
  organizations: Organization[];
  selectedOrganizationId: string | null;
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  repositories: Repository[];
  connections: Connection[];
}

interface SyncResponse {
  message?: string;
  synchronized?: { branches: number; commits: number };
}

interface IngestResponse {
  message?: string;
  ingested?: { files: number; skipped: number; limited: boolean };
}

export function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(
    async (organizationId?: string, workspaceId?: string) => {
      setLoading(true);
      setError("");
      const query = new URLSearchParams();
      if (organizationId) query.set("organizationId", organizationId);
      if (workspaceId) query.set("workspaceId", workspaceId);

      try {
        const response = await fetch(`/api/dashboard?${query.toString()}`, {
          cache: "no-store",
        });
        if (response.status === 401) {
          router.replace("/");
          router.refresh();
          return;
        }
        const result = (await response.json()) as DashboardData & {
          message?: string;
        };
        if (!response.ok) {
          setError(result.message ?? "Unable to load the dashboard");
          return;
        }
        setData(result);
      } catch {
        setError("Unable to reach the dashboard service.");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  async function synchronize(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    setSyncingId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`/api/repositories/${repository.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: data.selectedWorkspaceId }),
      });
      const result = (await response.json()) as SyncResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Repository synchronization failed");
        return;
      }

      setNotice(
        `${repository.name} synchronized: ${result.synchronized?.branches ?? 0} branches and ${result.synchronized?.commits ?? 0} commits.`,
      );
      await loadDashboard(
        data.selectedOrganizationId ?? undefined,
        data.selectedWorkspaceId,
      );
    } catch {
      setError("Unable to reach the synchronization service.");
    } finally {
      setSyncingId(null);
    }
  }

  async function ingest(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    setIngestingId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/repositories/${repository.id}/ingest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: data.selectedWorkspaceId }),
        },
      );
      const result = (await response.json()) as IngestResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Repository file ingestion failed");
        return;
      }

      setNotice(
        `${repository.name} indexed ${result.ingested?.files ?? 0} source files (${result.ingested?.skipped ?? 0} skipped).`,
      );
      await loadDashboard(
        data.selectedOrganizationId ?? undefined,
        data.selectedWorkspaceId,
      );
    } catch {
      setError("Unable to reach the file ingestion service.");
    } finally {
      setIngestingId(null);
    }
  }

  const activeConnection = data?.connections.find(
    (connection) => connection.status === "ACTIVE",
  );

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-mark dashboard-brand">
          <span>N</span>
          <strong>NexusDev AI</strong>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="secondary-button" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="workspace-layout">
        <aside className="workspace-sidebar">
          <div>
            <p className="eyebrow">Engineering console</p>
            <h1>Workspace</h1>
          </div>

          <label>
            Organization
            <select
              value={data?.selectedOrganizationId ?? ""}
              disabled={loading || !data?.organizations.length}
              onChange={(event) => void loadDashboard(event.target.value)}
            >
              {!data?.organizations.length && <option>No organizations</option>}
              {data?.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Workspace
            <select
              value={data?.selectedWorkspaceId ?? ""}
              disabled={loading || !data?.workspaces.length}
              onChange={(event) =>
                void loadDashboard(
                  data?.selectedOrganizationId ?? undefined,
                  event.target.value,
                )
              }
            >
              {!data?.workspaces.length && <option>No workspaces</option>}
              {data?.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>

          <div className="connection-card">
            <div className={`status-dot ${activeConnection ? "online" : ""}`} />
            <div>
              <strong>
                {activeConnection ? "GitHub connected" : "GitHub not connected"}
              </strong>
              <p>
                {activeConnection
                  ? `@${activeConnection.accountLogin}`
                  : "Connect a GitHub App to import code."}
              </p>
            </div>
          </div>
        </aside>

        <div className="repository-panel">
          <div className="repository-heading">
            <div>
              <p className="eyebrow">Repository intelligence</p>
              <h2>Your connected codebases</h2>
              <p>{data?.profile.user.email ?? "Loading your account…"}</p>
            </div>
            <span className="repo-total">
              {data?.repositories.length ?? 0} repositories
            </span>
          </div>

          {error && (
            <p className="dashboard-alert error" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="dashboard-alert success">{notice}</p>}

          {loading && !data ? (
            <div className="empty-state">
              Loading your engineering workspace…
            </div>
          ) : data?.repositories.length ? (
            <div className="repository-list">
              {data.repositories.map((repository) => (
                <article className="repository-row" key={repository.id}>
                  <div className="repo-icon">⌘</div>
                  <div className="repo-main">
                    <div className="repo-title">
                      {repository.url ? (
                        <a
                          href={repository.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {repository.name}
                        </a>
                      ) : (
                        repository.name
                      )}
                      <span>{repository.isPrivate ? "Private" : "Public"}</span>
                    </div>
                    <p>{repository.fullName}</p>
                    <div className="repo-metrics">
                      <span>
                        {repository.defaultBranch ?? "No default branch"}
                      </span>
                      <span>{repository._count.branches} branches</span>
                      <span>{repository._count.commits} commits</span>
                      <span>{repository._count.files} files</span>
                    </div>
                  </div>
                  <div className="repo-actions">
                    <button
                      className="sync-button"
                      type="button"
                      disabled={
                        syncingId === repository.id ||
                        ingestingId === repository.id
                      }
                      onClick={() => void synchronize(repository)}
                    >
                      {syncingId === repository.id
                        ? "Syncing…"
                        : "Sync metadata"}
                    </button>
                    <button
                      className="ingest-button"
                      type="button"
                      disabled={
                        ingestingId === repository.id ||
                        syncingId === repository.id
                      }
                      onClick={() => void ingest(repository)}
                    >
                      {ingestingId === repository.id
                        ? "Indexing…"
                        : "Index files"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>No repositories in this workspace yet.</strong>
              <p>
                Import one through your GitHub connection to begin indexing.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
