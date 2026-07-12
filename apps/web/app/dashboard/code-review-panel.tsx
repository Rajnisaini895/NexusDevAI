"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type SeverityFilter = "ALL" | Severity;

interface CodeReview {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  suggestion: string | null;
  createdAt: string;
}

interface ReviewsResponse {
  message?: string;
  model?: string;
  reviewed?: { chunks: number; issues: number };
  reviews?: CodeReview[];
  latestRun?: {
    model: string;
    chunksReviewed: number;
    issuesFound: number;
    createdAt: string;
  } | null;
}

const severityFilters: SeverityFilter[] = [
  "ALL",
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
];

function reviewSummary(chunks: number, issues: number) {
  return `${chunks} chunks reviewed · ${issues} findings`;
}

export function CodeReviewPanel({
  repositoryId,
  workspaceId,
  chunkCount,
}: {
  repositoryId: string;
  workspaceId: string;
  chunkCount: number;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviews, setReviews] = useState<CodeReview[]>([]);
  const [filter, setFilter] = useState<SeverityFilter>("ALL");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const visibleReviews = useMemo(
    () =>
      filter === "ALL"
        ? reviews
        : reviews.filter((review) => review.severity === filter),
    [filter, reviews],
  );

  async function handleResponse(response: Response) {
    if (response.status === 401) {
      router.replace("/");
      router.refresh();
      return null;
    }

    const result = (await response.json()) as ReviewsResponse;
    if (!response.ok) {
      throw new Error(result.message ?? "Code review request failed");
    }
    return result;
  }

  async function loadReviews() {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ workspaceId });
      const result = await handleResponse(
        await fetch(
          `/api/repositories/${repositoryId}/reviews?${query.toString()}`,
          { cache: "no-store" },
        ),
      );
      if (!result) return;
      setReviews(result.reviews ?? []);
      if (result.latestRun) {
        setSummary(
          reviewSummary(
            result.latestRun.chunksReviewed,
            result.latestRun.issuesFound,
          ),
        );
      }
      setLoaded(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load code reviews",
      );
    } finally {
      setLoading(false);
    }
  }

  async function togglePanel() {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !loaded) await loadReviews();
  }

  async function runReview() {
    setReviewing(true);
    setError("");
    setSummary("");
    try {
      const result = await handleResponse(
        await fetch(`/api/repositories/${repositoryId}/reviews`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, limit: 4 }),
        }),
      );
      if (!result) return;
      const nextReviews = result.reviews ?? [];
      setReviews(nextReviews);
      setLoaded(true);
      setExpanded(true);
      setFilter("ALL");
      setSummary(
        reviewSummary(result.reviewed?.chunks ?? 0, nextReviews.length),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to run code review",
      );
    } finally {
      setReviewing(false);
    }
  }

  return (
    <section className="code-review-panel">
      <div className="code-review-toolbar">
        <div>
          <strong>AI code review</strong>
          <span>{summary || "Find concrete risks in embedded code"}</span>
        </div>
        <div className="code-review-actions">
          <button type="button" onClick={() => void togglePanel()}>
            {expanded ? "Hide findings" : "View findings"}
          </button>
          <button
            className="run-review-button"
            type="button"
            disabled={reviewing || loading || chunkCount === 0}
            onClick={() => void runReview()}
          >
            {reviewing ? "Reviewing…" : "Run review"}
          </button>
        </div>
      </div>

      {error && (
        <p className="review-message error" role="alert">
          {error}
        </p>
      )}

      {expanded && (
        <div className="review-content">
          {loading ? (
            <p className="review-message">Loading saved findings…</p>
          ) : reviews.length ? (
            <>
              <div className="severity-filters" aria-label="Filter findings">
                {severityFilters.map((severity) => (
                  <button
                    className={filter === severity ? "active" : ""}
                    type="button"
                    key={severity}
                    aria-pressed={filter === severity}
                    onClick={() => setFilter(severity)}
                  >
                    {severity === "ALL" ? "All" : severity.toLowerCase()}
                  </button>
                ))}
              </div>
              <div className="review-list">
                {visibleReviews.length ? (
                  visibleReviews.map((review) => (
                    <article className="review-finding" key={review.id}>
                      <header>
                        <span
                          className={`severity-badge ${review.severity.toLowerCase()}`}
                        >
                          {review.severity}
                        </span>
                        <strong>{review.title}</strong>
                      </header>
                      {review.filePath && (
                        <code>
                          {review.filePath}
                          {review.startLine
                            ? `:${review.startLine}${review.endLine && review.endLine !== review.startLine ? `–${review.endLine}` : ""}`
                            : ""}
                        </code>
                      )}
                      <p>{review.description}</p>
                      {review.suggestion && (
                        <div className="review-suggestion">
                          <strong>Suggested fix</strong>
                          <p>{review.suggestion}</p>
                        </div>
                      )}
                    </article>
                  ))
                ) : (
                  <p className="review-message">
                    No {filter.toLowerCase()} findings in this review.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="review-message">
              {summary
                ? "No validated issues were found in the latest review."
                : chunkCount === 0
                  ? "Create chunks before running a review."
                  : "No saved findings yet. Create embeddings, then run a review."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
