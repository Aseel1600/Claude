import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { listExtractionConfigs } from "@omniroute/open-sse/services/tokenExtractionConfig.ts";
import { getWebSessionCredentialRequirement } from "@/shared/providers/webSessionCredentials";

export const WEB_SESSION_CONTRACT_VERSION = 1;

export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  const providers = listExtractionConfigs().flatMap((config) => {
    const requirement = getWebSessionCredentialRequirement(config.providerId);
    if (!requirement || requirement.kind === "none") return [];

    return [
      {
        providerId: config.providerId,
        displayName: config.displayName,
        loginUrl: config.loginUrl,
        homeUrl: config.homeUrl,
        tokenSources: config.tokenSources,
        credential: {
          kind: requirement.kind,
          storageKeys: requirement.storageKeys,
          acceptsFullCookieHeader: requirement.acceptsFullCookieHeader,
        },
      },
    ];
  });

  return NextResponse.json({
    version: WEB_SESSION_CONTRACT_VERSION,
    providers,
  });
}
