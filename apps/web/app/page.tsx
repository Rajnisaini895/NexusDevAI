import { AuthForm } from "./ui/auth-form";

const features = [
  "Connect repositories without sharing personal access tokens",
  "Synchronize branches and commit history from GitHub",
  "Keep engineering work organized by workspace",
];

export default function Home() {
  return (
    <main className="auth-shell">
      <section className="brand-panel">
        <div className="brand-mark" aria-label="NexusDev AI">
          <span>N</span>
          <strong>NexusDev AI</strong>
        </div>

        <div className="brand-copy">
          <p className="eyebrow">Developer intelligence, connected</p>
          <h1>Your codebase should explain itself.</h1>
          <p className="lede">
            Bring repositories, teams, and engineering context into one calm,
            searchable workspace.
          </p>
        </div>

        <ul className="feature-list">
          {features.map((feature) => (
            <li key={feature}>
              <span aria-hidden="true">✓</span>
              {feature}
            </li>
          ))}
        </ul>

        <p className="build-note">Built for teams who want less archaeology.</p>
      </section>

      <section className="form-panel">
        <AuthForm />
      </section>
    </main>
  );
}
