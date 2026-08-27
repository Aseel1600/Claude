import { NextResponse } from "next/server";

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listFiles } from "@/lib/db/files";

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
    const files = listFiles({ limit });
    return NextResponse.json({ files });
  } catch (error) {
    console.log("Error fetching files:", error);
    return NextResponse.json({ error: "Failed to fetch files" }, { status: 500 });
  }
}
