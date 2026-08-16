import { ZED_HOSTED_CONFIG } from "../constants/oauth";
import {
  createZedNativeAuthData,
  parseZedCallbackPayload,
  decryptZedAccessToken,
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "@omniroute/open-sse/shared/zedAuth.ts";

/**
 * Zed Hosted Models OAuth provider.
 *
 * flowType "authorization_code" (mirrors `cline`'s non-PKCE authorization_code
 * shape), but with a twist: `buildAuthUrl` returns `{ authUrl, codeVerifier }`
 * instead of a bare string — `codeVerifier` here carries the *RSA private key
 * verifier* (see zedAuth.ts::encodeZedPrivateKeyVerifier), reusing the
 * existing PKCE `codeVerifier` plumbing (generateAuthData → OAuthModal →
 * /exchange) as the transport for the keypair, since Zed's own flow has no
 * client_id/secret or authorization code to exchange — only a private key
 * needed to decrypt whatever access token the browser callback carries.
 *
 * `code` at exchange time is the pasted native-app callback URL/query string
 * (`http://127.0.0.1:<port>/?user_id=...&access_token=...`) — Zed always
 * redirects to loopback + native_app_port, ignoring any path we'd send. When
 * the dashboard itself listens on a loopback port, `buildAuthUrl` reuses it as
 * native_app_port so the redirect lands back on OmniRoute (auto-completed via
 * the /callback relay); otherwise the dead default port is used and the user
 * completes the flow by pasting the browser's full URL.
 */
/**
 * Extract the loopback port from the redirect URI the dashboard sent, so Zed's
 * browser redirect can land back on OmniRoute itself. Zed always redirects to
 * `http://127.0.0.1:<native_app_port>/` — it ignores any path/redirect_uri — so
 * reusing the dashboard's own loopback port (e.g. 20128) turns the dead
 * "site can't be reached" page into a loadable `/callback` relay (the root page
 * forwards ?user_id=...&access_token=... there). Non-loopback or non-http
 * redirect URIs (remote/LAN deployments) return null → keep the default port and
 * rely on the manual paste flow.
 */
function resolveDashboardLoopbackPort(redirectUri: unknown): number | null {
  try {
    const url = new URL(String(redirectUri));
    if (url.protocol !== "http:") return null;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) return null;
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export const zedHosted = {
  config: ZED_HOSTED_CONFIG,
  flowType: "authorization_code",
  buildAuthUrl: (config: typeof ZED_HOSTED_CONFIG, redirectUri?: string) => {
    const nativeAppPort =
      resolveDashboardLoopbackPort(redirectUri) || config.defaultNativeAppPort || 58443;
    const authData = createZedNativeAuthData(config, { nativeAppPort });
    return {
      authUrl: authData.authUrl,
      codeVerifier: authData.privateKeyVerifier,
      redirectUri: `http://127.0.0.1:${authData.nativeAppPort}/`,
    };
  },
  exchangeToken: async (
    config: typeof ZED_HOSTED_CONFIG,
    code: string,
    _redirectUri: string,
    codeVerifier: string
  ) => {
    const { userId, encryptedAccessToken } = parseZedCallbackPayload(code);
    const accessToken = decryptZedAccessToken(encryptedAccessToken, codeVerifier);

    const credentials = { accessToken, providerSpecificData: { userId } };
    let email: string | undefined;
    let name: string | undefined;
    let organizationId = "";
    try {
      const userInfo = await fetchZedAuthenticatedUser(credentials, { config });
      email = userInfo?.email || userInfo?.github_login;
      name = userInfo?.name || userInfo?.github_login;
      organizationId = resolveZedOrganizationId(credentials, userInfo);
    } catch {
      // Non-fatal — the account still works without a resolved email/org;
      // fetchZedLlmToken will resolve the organization lazily on first use.
    }

    return {
      access_token: accessToken,
      user_id: userId,
      email,
      name,
      organization_id: organizationId,
    };
  },
  mapTokens: (tokens: {
    access_token: string;
    user_id: string;
    email?: string;
    name?: string;
    organization_id?: string;
  }) => ({
    accessToken: tokens.access_token,
    // Zed's native-app access tokens are long-lived; no refresh flow is
    // exposed by the aggregator, so no expiresIn/refreshToken here.
    name: tokens.name || tokens.email || null,
    email: tokens.email,
    providerSpecificData: {
      userId: tokens.user_id,
      organizationId: tokens.organization_id || undefined,
    },
  }),
};

export default zedHosted;
