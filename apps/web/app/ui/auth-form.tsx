"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "login" | "register";

interface AuthResponse {
  message?: string;
  error?: string;
}

export function AuthForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      ...(mode === "register" && { fullName: form.get("fullName") }),
      email: form.get("email"),
      password: form.get("password"),
    };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as AuthResponse;

      if (!response.ok) {
        setError(result.message ?? result.error ?? "Unable to continue");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError(
        "The API is unavailable. Check that it is running on port 3001.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function changeMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <div className="auth-card">
      <div className="form-heading">
        <p className="eyebrow">Welcome to NexusDev</p>
        <h2>
          {mode === "login"
            ? "Sign in to your workspace"
            : "Create your account"}
        </h2>
        <p>
          {mode === "login"
            ? "Continue where your engineering team left off."
            : "Start building a connected view of your code."}
        </p>
      </div>

      <div className="mode-switch" aria-label="Authentication mode">
        <button
          type="button"
          className={mode === "login" ? "active" : ""}
          onClick={() => changeMode("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === "register" ? "active" : ""}
          onClick={() => changeMode("register")}
        >
          Create account
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {mode === "register" && (
          <label>
            Full name
            <input
              name="fullName"
              type="text"
              autoComplete="name"
              placeholder="Rajni Saini"
              required
            />
          </label>
        )}

        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
          />
        </label>

        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            placeholder="At least 8 characters"
            minLength={8}
            required
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting
            ? "Please wait…"
            : mode === "login"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <p className="security-note">
        Your session is stored in secure, HTTP-only cookies.
      </p>
    </div>
  );
}
