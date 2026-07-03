import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL } from "@/lib/auth";

interface ProfileResponse {
  user: { userId: string; email: string };
}

export default async function DashboardPage() {
  const accessToken = (await cookies()).get("nexus_access_token")?.value;

  if (!accessToken) redirect("/");

  let profile: ProfileResponse | null = null;

  try {
    const response = await fetch(`${API_URL}/auth/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.ok) profile = (await response.json()) as ProfileResponse;
  } catch {
    // The dashboard remains useful as a session landing page while API is offline.
  }

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

      <section className="dashboard-content">
        <p className="eyebrow">Workspace overview</p>
        <h1>Good to have you here.</h1>
        <p className="dashboard-lede">
          {profile?.user.email
            ? `Signed in as ${profile.user.email}`
            : "Your session is active. Start the API to load account details."}
        </p>

        <div className="dashboard-grid">
          <article>
            <span>01</span>
            <h2>Organizations</h2>
            <p>Choose the team and engineering context you want to explore.</p>
          </article>
          <article>
            <span>02</span>
            <h2>Repositories</h2>
            <p>
              Review connected codebases and synchronize their latest history.
            </p>
          </article>
          <article>
            <span>03</span>
            <h2>Intelligence</h2>
            <p>Code search and AI-assisted understanding are coming next.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
