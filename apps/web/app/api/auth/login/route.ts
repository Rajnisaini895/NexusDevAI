import { authenticate } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };

  if (!body.email || !body.password) {
    return Response.json(
      { message: "Email and password are required" },
      { status: 400 },
    );
  }

  try {
    return await authenticate(body.email, body.password);
  } catch {
    return Response.json(
      { message: "Authentication service unavailable" },
      { status: 503 },
    );
  }
}
