import { NextResponse } from "next/server";
import { ensureSchema } from "./setup";

// Shared helpers for the read-only export API. These endpoints let an external
// system (Salesforce via External Services / a scheduled Flow, or a middleman
// like Zapier / Make) pull the desk's data. They are OFF until EXPORT_TOKEN is
// set, and every request must present that token as a Bearer header (a ?token=
// query param is also accepted for tools that cannot set headers).

export type AuthResult = { ok: true } | { ok: false; status: number; message: string };

export function exportAuth(req: Request): AuthResult {
  const token = process.env.EXPORT_TOKEN;
  if (!token) {
    return { ok: false, status: 503, message: "Export API is not configured. Set EXPORT_TOKEN to enable it." };
  }
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.replace(/^Bearer\s+/i, "").trim();
  const query = new URL(req.url).searchParams.get("token")?.trim() ?? "";
  const provided = bearer || query;
  if (!provided || provided !== token) {
    return { ok: false, status: 401, message: "Unauthorized. Provide the export token as a Bearer header." };
  }
  return { ok: true };
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

// Run a read, self-healing the schema once if a table/column is missing.
export async function readWithHeal<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/i.test(msg)) {
      await ensureSchema();
      return await fn();
    }
    throw e;
  }
}

// Standard envelope so consumers get a stable shape.
export function exportJson(records: unknown[]) {
  return NextResponse.json({
    count: records.length,
    records,
  });
}
