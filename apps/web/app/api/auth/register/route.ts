import { API_URL, authenticate } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    fullName?: string;
    email?: string;
    password?: string;
  };

  if (!body.fullName || !body.email || !body.password) {
    return Response.json(
      { message: "Name, email, and password are required" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${API_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const result = (await response.json()) as { message?: string };

    if (!response.ok) {
      return Response.json(
        { message: result.message ?? "Registration failed" },
        { status: response.status },
      );
    }

    return authenticate(body.email, body.password);
  } catch {
    return Response.json(
      { message: "Registration service unavailable" },
      { status: 503 },
    );
  }
}
