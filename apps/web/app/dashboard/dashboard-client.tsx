"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CodeReviewPanel } from "./code-review-panel";

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
  externalId: string | null;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  url: string | null;
  isPrivate: boolean | null;
  processingRuns: ProcessingRun[];
  _count: { branches: number; commits: number; files: number; chunks: number };
}

type ProcessingStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
type ProcessingStage =
  | "QUEUED"
  | "SYNCING"
  | "INGESTING"
  | "CHUNKING"
  | "EMBEDDING"
  | "COMPLETED"
  | "FAILED";

interface ProcessingRun {
  id: string;
  repositoryId: string;
  status: ProcessingStatus;
  stage: ProcessingStage;
  progress: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProcessingResponse {
  message?: string;
  run?: ProcessingRun | null;
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

interface ChunkResponse {
  message?: string;
  chunked?: {
    filesProcessed: number;
    filesUnchanged: number;
    chunksCreated: number;
  };
}

interface EmbedResponse {
  message?: string;
  embedded?: { created: number; unchanged: number };
}

interface SearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  language: string | null;
  content: string;
  score: number;
}

interface SearchResponse {
  message?: string;
  results?: SearchResult[];
}

interface AnswerResponse {
  message?: string;
  answer?: string;
  model?: string;
  sources?: Array<{
    id: string;
    path: string;
    startLine: number;
    endLine: number;
    score: number;
  }>;
}

interface GithubRepository {
  externalId: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  url: string;
}

interface GithubRepositoriesResponse {
  message?: string;
  repositories?: GithubRepository[];
}

interface GithubInstallResponse {
  message?: string;
  installUrl?: string;
}

interface ImportResponse {
  message?: string;
  repository?: Repository;
}

const githubNotices: Record<string, string> = {
  connected: "GitHub connected. You can now import repositories.",
  cancelled: "GitHub connection was cancelled.",
};

const githubErrors: Record<string, string> = {
  "invalid-callback": "GitHub returned an invalid installation callback.",
  "session-expired": "Your session expired while connecting GitHub.",
  "connection-failed": "GitHub connection could not be completed.",
};

const processingStageLabels: Record<ProcessingStage, string> = {
  QUEUED: "Waiting for worker",
  SYNCING: "Synchronizing metadata",
  INGESTING: "Indexing source files",
  CHUNKING: "Building code chunks",
  EMBEDDING: "Creating embeddings",
  COMPLETED: "Ready for AI",
  FAILED: "Processing failed",
};

function isProcessingActive(run: ProcessingRun) {
  return run.status === "QUEUED" || run.status === "RUNNING";
}

export function DashboardClient({ githubStatus }: { githubStatus?: string }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState(
    () => githubErrors[githubStatus ?? ""] ?? "",
  );
  const [loading, setLoading] = useState(true);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [chunkingId, setChunkingId] = useState<string | null>(null);
  const [embeddingId, setEmbeddingId] = useState<string | null>(null);
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>(
    {},
  );
  const [searchResults, setSearchResults] = useState<
    Record<string, SearchResult[]>
  >({});
  const [answers, setAnswers] = useState<Record<string, AnswerResponse>>({});
  const [notice, setNotice] = useState(
    () => githubNotices[githubStatus ?? ""] ?? "",
  );
  const [connectingGithub, setConnectingGithub] = useState(false);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [discoveringRepositories, setDiscoveringRepositories] = useState(false);
  const [availableRepositories, setAvailableRepositories] = useState<
    GithubRepository[] | null
  >(null);
  const [importingRepositoryId, setImportingRepositoryId] = useState<
    string | null
  >(null);
  const [processingRuns, setProcessingRuns] = useState<
    Record<string, ProcessingRun>
  >({});

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
        setProcessingRuns(
          Object.fromEntries(
            result.repositories.flatMap((repository) => {
              const run = repository.processingRuns[0];
              return run ? [[repository.id, run]] : [];
            }),
          ),
        );
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

  const activeProcessingKey = Object.entries(processingRuns)
    .filter(([, run]) => isProcessingActive(run))
    .map(([repositoryId]) => repositoryId)
    .sort()
    .join(",");

  useEffect(() => {
    const workspaceId = data?.selectedWorkspaceId;
    if (!activeProcessingKey || !workspaceId) return;
    const selectedWorkspaceId = workspaceId;
    const repositoryIds = activeProcessingKey.split(",");
    let cancelled = false;

    async function refreshProcessingRuns() {
      const updates = await Promise.all(
        repositoryIds.map(async (repositoryId) => {
          const query = new URLSearchParams({
            workspaceId: selectedWorkspaceId,
          });
          const response = await fetch(
            `/api/repositories/${repositoryId}/process?${query.toString()}`,
            { cache: "no-store" },
          );
          if (response.status === 401) {
            router.replace("/");
            router.refresh();
            return null;
          }
          if (!response.ok) return null;
          const result = (await response.json()) as ProcessingResponse;
          return result.run ? ([repositoryId, result.run] as const) : null;
        }),
      );
      if (cancelled) return;

      const validUpdates = updates.filter(
        (update): update is readonly [string, ProcessingRun] => update !== null,
      );
      if (validUpdates.length) {
        setProcessingRuns((current) => ({
          ...current,
          ...Object.fromEntries(validUpdates),
        }));
      }
      if (validUpdates.some(([, run]) => run.status === "COMPLETED")) {
        await loadDashboard(
          data?.selectedOrganizationId ?? undefined,
          selectedWorkspaceId,
        );
      }
    }

    void refreshProcessingRuns();
    const interval = window.setInterval(
      () => void refreshProcessingRuns(),
      1500,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeProcessingKey, data, loadDashboard, router]);

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

  async function buildChunks(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    setChunkingId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`/api/repositories/${repository.id}/chunk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: data.selectedWorkspaceId }),
      });
      const result = (await response.json()) as ChunkResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Code chunking failed");
        return;
      }

      setNotice(
        `${repository.name} created ${result.chunked?.chunksCreated ?? 0} chunks; ${result.chunked?.filesUnchanged ?? 0} unchanged files skipped.`,
      );
      await loadDashboard(
        data.selectedOrganizationId ?? undefined,
        data.selectedWorkspaceId,
      );
    } catch {
      setError("Unable to reach the code chunking service.");
    } finally {
      setChunkingId(null);
    }
  }

  async function createEmbeddings(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    setEmbeddingId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`/api/repositories/${repository.id}/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: data.selectedWorkspaceId }),
      });
      const result = (await response.json()) as EmbedResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Embedding generation failed");
        return;
      }

      setNotice(
        `${repository.name} embedded ${result.embedded?.created ?? 0} chunks; ${result.embedded?.unchanged ?? 0} were already current.`,
      );
    } catch {
      setError("Unable to reach the embedding service.");
    } finally {
      setEmbeddingId(null);
    }
  }

  async function semanticSearch(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    const query = searchQueries[repository.id]?.trim();
    if (!query) return;
    setSearchingId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/repositories/${repository.id}/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: data.selectedWorkspaceId,
            query,
          }),
        },
      );
      const result = (await response.json()) as SearchResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Semantic search failed");
        return;
      }
      setSearchResults((current) => ({
        ...current,
        [repository.id]: result.results ?? [],
      }));
    } catch {
      setError("Unable to reach semantic search.");
    } finally {
      setSearchingId(null);
    }
  }

  async function askQuestion(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    const query = searchQueries[repository.id]?.trim();
    if (!query) return;
    setAnsweringId(repository.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(`/api/repositories/${repository.id}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.selectedWorkspaceId,
          query,
        }),
      });
      const result = (await response.json()) as AnswerResponse;
      if (response.status === 401) {
        router.replace("/");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setError(result.message ?? "Repository question failed");
        return;
      }
      setAnswers((current) => ({ ...current, [repository.id]: result }));
    } catch {
      setError("Unable to reach the repository question service.");
    } finally {
      setAnsweringId(null);
    }
  }

  function handleUnauthorized(response: Response) {
    if (response.status !== 401) return false;
    router.replace("/");
    router.refresh();
    return true;
  }

  async function connectGithub() {
    if (!data?.selectedOrganizationId) return;
    setConnectingGithub(true);
    setNotice("");
    setError("");

    try {
      const query = new URLSearchParams({
        organizationId: data.selectedOrganizationId,
      });
      const response = await fetch(
        `/api/provider-connections/github/install-url?${query.toString()}`,
        { cache: "no-store" },
      );
      if (handleUnauthorized(response)) return;
      const result = (await response.json()) as GithubInstallResponse;
      if (!response.ok || !result.installUrl) {
        setError(result.message ?? "Unable to start GitHub connection");
        return;
      }
      window.location.assign(result.installUrl);
    } catch {
      setError("Unable to reach the GitHub connection service.");
    } finally {
      setConnectingGithub(false);
    }
  }

  async function toggleRepositoryPicker() {
    const nextOpen = !repositoryPickerOpen;
    setRepositoryPickerOpen(nextOpen);
    if (
      !nextOpen ||
      availableRepositories ||
      !data?.selectedOrganizationId ||
      !activeConnection
    ) {
      return;
    }

    setDiscoveringRepositories(true);
    setNotice("");
    setError("");
    try {
      const query = new URLSearchParams({
        organizationId: data.selectedOrganizationId,
      });
      const response = await fetch(
        `/api/provider-connections/${activeConnection.id}/repositories?${query.toString()}`,
        { cache: "no-store" },
      );
      if (handleUnauthorized(response)) return;
      const result = (await response.json()) as GithubRepositoriesResponse;
      if (!response.ok) {
        setError(result.message ?? "Unable to discover GitHub repositories");
        return;
      }
      setAvailableRepositories(result.repositories ?? []);
    } catch {
      setError("Unable to reach GitHub repository discovery.");
    } finally {
      setDiscoveringRepositories(false);
    }
  }

  async function importRepository(repository: GithubRepository) {
    if (!data?.selectedWorkspaceId || !activeConnection) return;
    setImportingRepositoryId(repository.externalId);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/repositories/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.selectedWorkspaceId,
          connectionId: activeConnection.id,
          externalRepositoryId: repository.externalId,
        }),
      });
      if (handleUnauthorized(response)) return;
      const result = (await response.json()) as ImportResponse;
      if (!response.ok) {
        setError(result.message ?? "Repository import failed");
        return;
      }
      setNotice(`${repository.fullName} imported successfully.`);
      setAvailableRepositories(
        (current) =>
          current?.filter(
            (candidate) => candidate.externalId !== repository.externalId,
          ) ?? null,
      );
      await loadDashboard(
        data.selectedOrganizationId ?? undefined,
        data.selectedWorkspaceId,
      );
    } catch {
      setError("Unable to reach the repository import service.");
    } finally {
      setImportingRepositoryId(null);
    }
  }

  async function prepareRepository(repository: Repository) {
    if (!data?.selectedWorkspaceId) return;
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/repositories/${repository.id}/process`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: data.selectedWorkspaceId }),
        },
      );
      if (handleUnauthorized(response)) return;
      const result = (await response.json()) as ProcessingResponse;
      if (!response.ok || !result.run) {
        setError(result.message ?? "Repository processing could not start");
        return;
      }
      setProcessingRuns((current) => ({
        ...current,
        [repository.id]: result.run!,
      }));
      setNotice(`${repository.name} is being prepared for AI.`);
    } catch {
      setError("Unable to reach the repository processing service.");
    }
  }

  const activeConnection = data?.connections.find(
    (connection) => connection.status === "ACTIVE",
  );
  const selectedOrganization = data?.organizations.find(
    (organization) => organization.id === data.selectedOrganizationId,
  );
  const canManageConnections =
    selectedOrganization?.role === "OWNER" ||
    selectedOrganization?.role === "ADMIN";
  const importedExternalIds = new Set(
    data?.repositories
      .map((repository) => repository.externalId)
      .filter((externalId): externalId is string => Boolean(externalId)) ?? [],
  );
  const importableRepositories =
    availableRepositories?.filter(
      (repository) => !importedExternalIds.has(repository.externalId),
    ) ?? [];

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
              onChange={(event) => {
                setRepositoryPickerOpen(false);
                setAvailableRepositories(null);
                void loadDashboard(event.target.value);
              }}
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
              onChange={(event) => {
                setRepositoryPickerOpen(false);
                setAvailableRepositories(null);
                void loadDashboard(
                  data?.selectedOrganizationId ?? undefined,
                  event.target.value,
                );
              }}
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

          <section className="github-onboarding">
            <div>
              <p className="eyebrow">
                {activeConnection ? "GitHub connected" : "Connect source code"}
              </p>
              <h3>
                {activeConnection
                  ? `Import from @${activeConnection.accountLogin}`
                  : "Connect your GitHub App"}
              </h3>
              <p>
                {activeConnection
                  ? "Choose an installation repository and add it to this workspace."
                  : "Authorize repository access without storing a personal access token."}
              </p>
            </div>
            {activeConnection ? (
              <button
                type="button"
                disabled={!data?.selectedWorkspaceId || discoveringRepositories}
                onClick={() => void toggleRepositoryPicker()}
              >
                {discoveringRepositories
                  ? "Loading repositories…"
                  : repositoryPickerOpen
                    ? "Close repository picker"
                    : "Import repository"}
              </button>
            ) : (
              <button
                type="button"
                disabled={
                  connectingGithub ||
                  !data?.selectedOrganizationId ||
                  !canManageConnections
                }
                onClick={() => void connectGithub()}
              >
                {connectingGithub ? "Opening GitHub…" : "Connect GitHub"}
              </button>
            )}

            {!activeConnection &&
              !canManageConnections &&
              selectedOrganization && (
                <p className="github-permission-note">
                  An organization owner or admin must connect GitHub.
                </p>
              )}

            {activeConnection && repositoryPickerOpen && (
              <div className="github-repository-picker">
                {discoveringRepositories ? (
                  <p>Loading repositories available to this installation…</p>
                ) : importableRepositories.length ? (
                  importableRepositories.map((repository) => (
                    <article key={repository.externalId}>
                      <div>
                        <strong>{repository.fullName}</strong>
                        <span>
                          {repository.private ? "Private" : "Public"} ·{" "}
                          {repository.defaultBranch}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={importingRepositoryId !== null}
                        onClick={() => void importRepository(repository)}
                      >
                        {importingRepositoryId === repository.externalId
                          ? "Importing…"
                          : "Import"}
                      </button>
                    </article>
                  ))
                ) : (
                  <p>
                    {availableRepositories
                      ? "Every available repository is already imported."
                      : "Open the picker to discover repositories."}
                  </p>
                )}
              </div>
            )}
          </section>

          {loading && !data ? (
            <div className="empty-state">
              Loading your engineering workspace…
            </div>
          ) : data?.repositories.length ? (
            <div className="repository-list">
              {data.repositories.map((repository) => {
                const processingRun =
                  processingRuns[repository.id] ?? repository.processingRuns[0];
                const processingActive =
                  processingRun && isProcessingActive(processingRun);

                return (
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
                        <span>
                          {repository.isPrivate ? "Private" : "Public"}
                        </span>
                      </div>
                      <p>{repository.fullName}</p>
                      <div className="repo-metrics">
                        <span>
                          {repository.defaultBranch ?? "No default branch"}
                        </span>
                        <span>{repository._count.branches} branches</span>
                        <span>{repository._count.commits} commits</span>
                        <span>{repository._count.files} files</span>
                        <span>{repository._count.chunks} chunks</span>
                      </div>
                    </div>
                    <div className="repo-actions">
                      <button
                        className="prepare-button"
                        type="button"
                        disabled={Boolean(processingActive)}
                        onClick={() => void prepareRepository(repository)}
                      >
                        {processingActive
                          ? "Preparing…"
                          : processingRun?.status === "FAILED"
                            ? "Retry preparation"
                            : processingRun?.status === "COMPLETED"
                              ? "Re-prepare for AI"
                              : "Prepare for AI"}
                      </button>
                      <button
                        className="sync-button"
                        type="button"
                        disabled={
                          Boolean(processingActive) ||
                          syncingId === repository.id ||
                          ingestingId === repository.id ||
                          chunkingId === repository.id ||
                          embeddingId === repository.id
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
                          Boolean(processingActive) ||
                          ingestingId === repository.id ||
                          syncingId === repository.id ||
                          chunkingId === repository.id ||
                          embeddingId === repository.id
                        }
                        onClick={() => void ingest(repository)}
                      >
                        {ingestingId === repository.id
                          ? "Indexing…"
                          : "Index files"}
                      </button>
                      <button
                        className="chunk-button"
                        type="button"
                        disabled={
                          Boolean(processingActive) ||
                          chunkingId === repository.id ||
                          syncingId === repository.id ||
                          ingestingId === repository.id ||
                          embeddingId === repository.id ||
                          repository._count.files === 0
                        }
                        onClick={() => void buildChunks(repository)}
                      >
                        {chunkingId === repository.id
                          ? "Chunking…"
                          : "Build chunks"}
                      </button>
                      <button
                        className="embed-button"
                        type="button"
                        disabled={
                          Boolean(processingActive) ||
                          embeddingId === repository.id ||
                          syncingId === repository.id ||
                          ingestingId === repository.id ||
                          chunkingId === repository.id ||
                          repository._count.chunks === 0
                        }
                        onClick={() => void createEmbeddings(repository)}
                      >
                        {embeddingId === repository.id
                          ? "Embedding…"
                          : "Create embeddings"}
                      </button>
                    </div>
                    {processingRun && (
                      <div
                        className={`processing-status ${processingRun.status.toLowerCase()}`}
                        role="status"
                      >
                        <div>
                          <strong>
                            {processingStageLabels[processingRun.stage]}
                          </strong>
                          <span>{processingRun.progress}%</span>
                        </div>
                        <div className="processing-track" aria-hidden="true">
                          <span
                            style={{ width: `${processingRun.progress}%` }}
                          />
                        </div>
                        {processingRun.errorMessage && (
                          <p>{processingRun.errorMessage}</p>
                        )}
                      </div>
                    )}
                    <div className="semantic-search">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void askQuestion(repository);
                        }}
                      >
                        <input
                          type="search"
                          value={searchQueries[repository.id] ?? ""}
                          minLength={2}
                          maxLength={1000}
                          placeholder="Search this codebase by meaning…"
                          onChange={(event) =>
                            setSearchQueries((current) => ({
                              ...current,
                              [repository.id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          className="search-button"
                          type="button"
                          disabled={
                            searchingId === repository.id ||
                            answeringId === repository.id ||
                            !(searchQueries[repository.id] ?? "").trim()
                          }
                          onClick={() => void semanticSearch(repository)}
                        >
                          {searchingId === repository.id
                            ? "Searching…"
                            : "Search"}
                        </button>
                        <button
                          className="ask-button"
                          type="submit"
                          disabled={
                            answeringId === repository.id ||
                            searchingId === repository.id ||
                            !(searchQueries[repository.id] ?? "").trim()
                          }
                        >
                          {answeringId === repository.id
                            ? "Thinking…"
                            : "Ask AI"}
                        </button>
                      </form>
                      {answers[repository.id]?.answer && (
                        <section className="ai-answer">
                          <div className="ai-answer-heading">
                            <strong>Repository answer</strong>
                            <span>{answers[repository.id].model}</span>
                          </div>
                          <p>{answers[repository.id].answer}</p>
                          <div className="answer-sources">
                            {answers[repository.id].sources?.map((source) => (
                              <span key={source.id}>
                                {source.path}:{source.startLine}–
                                {source.endLine}
                              </span>
                            ))}
                          </div>
                        </section>
                      )}
                      {searchResults[repository.id] && (
                        <div className="search-results">
                          {searchResults[repository.id].length ? (
                            searchResults[repository.id].map((result) => (
                              <article key={result.id}>
                                <header>
                                  <strong>{result.path}</strong>
                                  <span>
                                    lines {result.startLine}–{result.endLine} ·{" "}
                                    {Math.round(result.score * 100)}% match
                                  </span>
                                </header>
                                <pre>
                                  <code>{result.content}</code>
                                </pre>
                              </article>
                            ))
                          ) : (
                            <p>No embedded code matched this query.</p>
                          )}
                        </div>
                      )}
                    </div>
                    {data.selectedWorkspaceId && (
                      <CodeReviewPanel
                        repositoryId={repository.id}
                        workspaceId={data.selectedWorkspaceId}
                        chunkCount={repository._count.chunks}
                      />
                    )}
                  </article>
                );
              })}
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
