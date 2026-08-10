---
title: OmniRoute Intelligence Governor V1
description: Deterministic, provider-neutral routing intelligence for OmniRoute.
---

# OmniRoute Intelligence Governor V1

The Governor is a deterministic, provider-neutral control plane that does not require S3. Modes are `off`, `shadow`, `simulate`, `active-canary`, and `active`; the default is `off`.

Active behavior is opt-in, bounded by factual capability/context/provider/quota/cost guards, and applied only through an explicit mutation boundary. Set the mode to `off` for emergency rollback. Telemetry is metadata-only and best effort; unknown prices, usage, and outcomes remain unknown.

Profiles are `economy`, `balanced`, and `quality`. Calibration is offline and never self-modifies production policy. Future S3 integration may replace the Governor implementation behind the provider-neutral interface, but S3 is not a runtime dependency.
