import { getWebSessionCredentialRequirement } from "@/shared/providers/webSessionCredentials";

export function shouldUseApiKeyConnectionTest(authType: unknown, providerId: unknown): boolean {
  if (authType === "apikey") return true;
  if (authType !== "cookie") return false;
  return getWebSessionCredentialRequirement(providerId)?.kind === "token";
}
