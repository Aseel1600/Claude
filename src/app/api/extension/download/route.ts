import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isAuthRequired, isAuthenticated } from "@/shared/utils/apiAuth";
import { personalizeVsix, resolveInstanceOrigin } from "./personalizeVsix";

/** Filename of the extension VSIX served by this endpoint. */
const EXTENSION_FILENAME = "ia-one.vsix";

/**
 * GET /api/extension/download
 * Serves the VS Code extension VSIX for download.
 * The file is expected at public/extension/<EXTENSION_FILENAME>.
 */
export async function GET(request: Request) {
  if (await isAuthRequired(request)) {
    if (!(await isAuthenticated(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const filePath = path.join(process.cwd(), "public", "extension", EXTENSION_FILENAME);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: "Extension package not found. Build it and place it in public/extension/." },
      { status: 404 }
    );
  }

  const buffer = fs.readFileSync(filePath);
  // The package is served BY this instance, so it leaves already knowing how to
  // reach it. Only the API key is left for the operator to fill in.
  const payload = personalizeVsix(new Uint8Array(buffer), resolveInstanceOrigin(request));

  return new NextResponse(payload, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${EXTENSION_FILENAME}"`,
      "Content-Length": String(payload.length),
      "Cache-Control": "no-store",
    },
  });
}
