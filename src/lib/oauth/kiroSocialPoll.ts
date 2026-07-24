export type KiroSocialPollData = {
  error?: unknown;
  accessToken?: unknown;
  refreshToken?: unknown;
};

export type KiroSocialPollOutcome =
  | { kind: "pending"; error: "authorization_pending" | "slow_down" }
  | { kind: "error"; error: string; status: number }
  | { kind: "success" };

function errorCode(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "authorization_failed";
}

export function classifyKiroSocialPoll(
  responseOk: boolean,
  responseStatus: number,
  data: KiroSocialPollData
): KiroSocialPollOutcome {
  if (data.error === "authorization_pending" || data.error === "slow_down") {
    return { kind: "pending", error: data.error };
  }

  if (!responseOk || data.error) {
    const status = responseStatus >= 400 && responseStatus <= 599 ? responseStatus : 400;
    return { kind: "error", error: errorCode(data.error), status };
  }

  if (!data.accessToken && !data.refreshToken) {
    return { kind: "error", error: "invalid_token_response", status: 502 };
  }

  return { kind: "success" };
}
