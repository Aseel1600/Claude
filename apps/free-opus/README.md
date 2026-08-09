# Free Opus — MVP (prototype)

This folder contains a minimal Next.js scaffold for the Free Opus MVP (Jamstack site + AI-generated animated videos).

Quick start (inside apps/free-opus):

1. Install dependencies: `npm install`
2. Run dev: `npm run dev`
3. Open http://localhost:3000

Important notes
- Do NOT commit API keys. Provide them via environment variables in your deployment (Vercel secrets/env).
- This scaffold uses mocked adapters when keys are not present so the UI can demo without real provider credentials.

ENV variables (development / production):
- OPENAI_API_KEY - (optional) OpenAI API key. If absent, the app returns mocked completions.
- RUNWAY_API_KEY - (optional) Runway API key; runway adapter is mocked here.
- STORAGE_S3_ENDPOINT / STORAGE_S3_KEY / STORAGE_S3_SECRET - (optional) S3-compatible storage settings for assets.
- STRIPE_SECRET_KEY - (optional) Stripe secret for billing integration.
- AUTH_PROVIDER - (optional) e.g., clerk or auth0 - scaffolding only.

Roadmap / TODOs
- Replace in-memory queue with Redis-backed queue (bullmq or RSMQ)
- Replace Runway mock with real Runway adapter and robust retry/backoff
- Implement auth (Clerk/Auth0) and per-tenant isolation
- Implement storage using AWS SDK and presigned URLs
- Add Stripe billing + trial flow
- Add CI/CD (Vercel) deployment guide and environment spec

API endpoints
- POST /api/generate/site  { prompt }
- POST /api/generate/video { prompt } -> returns jobId
- GET  /api/status?jobId=... -> job status

Tests
- Add unit tests under tests/ and wire a test runner.

License: MIT
