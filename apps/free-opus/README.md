# Free Opus — MVP (prototype)

This folder contains a minimal Next.js scaffold for the Free Opus MVP (Jamstack site + AI-generated animated videos).

Quick start (inside apps/free-opus):

1. Install dependencies: `npm install`
2. Run dev: `npm run dev`
3. Open http://localhost:3000
4. Start the background worker (separate process): `node workers/worker.js`

Important notes
- Do NOT commit API keys. Provide them via environment variables in your deployment (Vercel secrets/env).
- This scaffold uses mocked adapters when keys are not present so the UI can demo without real provider credentials.
- The in-memory queue is for demo only. Set REDIS_URL to use a Redis-backed queue.

ENV variables (development / production)
- OPENAI_API_KEY - (optional) OpenAI API key. If absent, the app returns mocked completions.
- RUNWAY_API_KEY - (optional) Runway API key; runway adapter is mocked here.
- STORAGE_S3_ENDPOINT - (optional) S3-compatible endpoint (e.g., https://s3.amazonaws.com or MinIO).
- STORAGE_S3_KEY - (optional) S3 access key
- STORAGE_S3_SECRET - (optional) S3 secret key
- STORAGE_S3_BUCKET - (optional) S3 bucket name used for presigns
- STORAGE_S3_REGION - (optional) S3 region (default us-east-1)
- STRIPE_SECRET_KEY - (optional) Stripe secret for billing integration.
- AUTH_PROVIDER - (optional) e.g., clerk or auth0 - scaffolding only.
- REDIS_URL - (optional) when set the app will use a Redis-backed queue implementation (ioredis required)
- REDIS_QUEUE_KEY - (optional) Redis list key for jobs (default: free-opus:jobs)

Local dev notes
- With no provider keys the app still demos using mocks.
- To demo render job processing locally: run `npm run dev` in one shell and `node workers/worker.js` in another. Use the UI to submit video jobs and poll /api/status

Roadmap / TODOs
- Replace mock adapters with real provider integrations (Runway, ElevenLabs, OpenAI production settings)
- Integrate auth (Clerk/Auth0) for tenant isolation
- Integrate Stripe for trial + billing (webhooks + subscription management)
- Harden queue with Redis and add retry/backoff with exponential policy
- Use durable storage (S3) for assets and sign URLs server-side
- Add rate-limiting middleware (currently basic in-memory limiter added)
- Add unit and integration tests, coverage and CI gates

API endpoints
- POST /api/generate/site  { prompt }
- POST /api/generate/video { prompt } -> returns jobId
- GET  /api/status?jobId=... -> job status
- POST /api/auth/login { email } -> mock token
- GET  /api/auth/me (Authorization: <token>) -> mock user
- POST /api/stripe/create-customer { email } -> mock or Stripe-backed
- POST /api/stripe/create-subscription { customerId, priceId } -> mock or Stripe-backed

Tests included
- tests/unit/runway.test.js — basic unit test for runway mock

What was changed in this branch
- Added initial scaffold: pages, API endpoints, lib adapters (openai mock, runway mock, elevenlabs mock)
- Added queue wrapper with optional Redis adapter
- Added S3 adapter with presign fallback (requires @aws-sdk packages to enable)
- Added worker script to poll queue and simulate renders
- CI (GitHub Actions) workflow and vercel.json configuration

How to hand off (push-blocker)
- This branch is committed locally as `tatianadug-feat-free-opus-mvp` but remote push returned 403 due to permissions.
- Two options to publish code remotely:
  1. Grant push permission for this account and push the branch: `git push -u origin tatianadug-feat-free-opus-mvp`
  2. Apply the generated patch file in session artifacts: `git am 0001-feat-free-opus.patch` (patch placed in the Copilot session artifacts)

Next steps for production hardening
- Add real provider wiring (Runway SDK, ElevenLabs SDK, OpenAI production model selection)
- Implement tenant-scoped DB (users, projects, job metadata)
- Add Redis + worker autoscaling (serverless queue or background workers)
- Add rate-limiter using Redis or API gateway level rules
- Add Stripe webhooks and entitlement checks
- Add Vercel environment variables and secrets, then enable automatic deployments

License: MIT
