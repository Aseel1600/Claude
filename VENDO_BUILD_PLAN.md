# Vendo Platform — MVP Build Plan

## Overview
**Vendo** is an African commerce platform enabling merchants to sell online, accept payments, and manage their business with zero setup fees. The MVP (Phase 1) focuses on core functionality: Store builder, Checkout, Payment processing, and Merchant Dashboard.

**Timeline:** 8–12 weeks for Phase 1 MVP

---

## Phase 1: MVP — Launch (8–12 weeks)

### Core Features
- ✅ Vendo Store builder (no-code, drag-drop templates)
- ✅ Vendo Checkout (PCI-compliant, mobile-first)
- ✅ Vendo Pay (2 initial gateways: Ozow + Paystack)
- ✅ Merchant Dashboard (Overview, Orders, Products, Payments, Customers, Analytics)
- ✅ Merchant onboarding + KYC verification
- ✅ Email / SMS notifications

### Technology Stack

#### Frontend
- **Framework:** Next.js 14 (App Router, SSR, SEO-optimised)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Animations:** Framer Motion (for checkout flow)
- **Forms:** React Hook Form + Zod validation
- **Charts:** Recharts (analytics dashboard)
- **Deployment:** Vercel (Edge CDN, auto-deploy from GitHub)

#### Backend
- **Runtime:** Node.js + Express/Next.js API routes
- **Database:** PostgreSQL (Supabase managed)
- **ORM:** Prisma (type-safe DB access)
- **Auth:** NextAuth.js (JWT + social login)
- **Validation:** Zod schemas
- **Logging:** Pino

#### Payment & Integrations
- **Payment Abstraction:** Adapter pattern (provider-agnostic)
- **Initial Gateways:**
  - Ozow (ZA EFT, no card required)
  - Paystack (NG, GH, ZA, KE - cards + bank transfers)
- **Webhooks:** Signed webhook delivery, exponential backoff
- **Settlement:** T+1/T+2 payouts

#### Infrastructure & DevOps
- **Hosting:** Vercel (frontend) + Supabase (backend/DB)
- **DNS/Security:** Cloudflare (DDoS, Edge caching)
- **CI/CD:** GitHub Actions (auto-deploy on merge)
- **Monitoring:** Sentry (error tracking)
- **Email:** SendGrid / Resend
- **SMS:** Twilio / Africa's Talking
- **Analytics:** Google Analytics 4

#### AI & Automation (Phase 1 light)
- **Automation:** n8n workflows (welcome emails, order notifications)
- **CRM:** Slack alerts for order notifications

---

## Project Structure

```
vendo/
├── apps/
│   ├── web/                          # Next.js storefront + dashboard
│   │   ├── src/
│   │   │   ├── app/                  # App Router pages
│   │   │   │   ├── (auth)/           # Auth pages (login, register)
│   │   │   │   ├── (merchant)/       # Merchant dashboard
│   │   │   │   ├── (store)/          # Store builder
│   │   │   │   ├── api/              # API routes (webhooks, etc.)
│   │   │   │   └── checkout/         # Checkout flow
│   │   │   ├── components/           # Reusable React components
│   │   │   ├── lib/                  # Utility functions
│   │   │   ├── middleware/           # NextAuth middleware
│   │   │   ├── styles/               # Global CSS
│   │   │   └── types/                # TypeScript types
│   │   ├── public/                   # Static assets (logo, etc.)
│   │   ├── prisma/                   # Database schema
│   │   └── package.json
│   │
│   └── docs/                         # Deployment & API docs
│
├── packages/
│   ├── payments/                     # Payment adapter abstraction
│   │   ├── src/
│   │   │   ├── adapters/             # Provider implementations
│   │   │   │   ├── ozow.ts
│   │   │   │   ├── paystack.ts
│   │   │   │   └── index.ts
│   │   │   ├── types/
│   │   │   │   └── adapter.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── db/                           # Database utilities
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   └── prisma-client.ts
│   │   └── package.json
│   │
│   ├── shared/                       # Shared types & constants
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── constants/
│   │   │   └── utils/
│   │   └── package.json
│   │
│   └── ui/                           # Shared UI components
│       ├── src/
│       │   └── components/
│       └── package.json
│
├── .env.example
├── .github/workflows/                # CI/CD pipelines
├── docker-compose.yml                # Local dev environment
├── package.json                      # Monorepo root
├── tsconfig.json
├── turbo.json                        # Monorepo build config
└── README.md
```

---

## Database Schema (Phase 1)

### Core Tables
1. **users** — Platform users (merchants, admins)
2. **businesses** — Merchant business info (company name, tax ID, KYC status)
3. **stores** — Merchant storefronts
4. **products** — Inventory
5. **orders** — Customer orders
6. **payments** — Payment transactions
7. **transactions** — Settlement records
8. **invoices** — Invoicing
9. **api_keys** — 3rd-party API access
10. **webhooks** — Merchant webhook endpoints
11. **notifications** — Email/SMS queue
12. **audit_logs** — Compliance & audit trail

---

## Build Phases

### Week 1–2: Foundation & Core Infrastructure
- [ ] Project scaffolding (monorepo, CI/CD)
- [ ] Database schema & migrations
- [ ] NextAuth setup (email + Google OAuth)
- [ ] Prisma ORM integration
- [ ] Payment adapter abstraction
- [ ] Ozow adapter implementation
- [ ] Paystack adapter implementation

### Week 3–4: Merchant Onboarding
- [ ] Merchant signup flow (email/Google)
- [ ] Business details form
- [ ] KYC/FICA verification (ID, bank account)
- [ ] Store creation wizard
- [ ] Admin approval workflow

### Week 5–6: Store Builder
- [ ] Drag-drop store builder (Next.js + Tailwind)
- [ ] Pre-built store templates
- [ ] Store customization (theme, logo, banner)
- [ ] Product management (CRUD, images, inventory)
- [ ] Store preview & live publishing

### Week 7–8: Checkout & Payments
- [ ] Vendo Checkout component (PCI-compliant)
- [ ] Payment method selection (card, EFT, bank transfer)
- [ ] Payment adapter routing
- [ ] Webhook handling & order confirmation
- [ ] Receipt & invoice generation

### Week 9–10: Merchant Dashboard
- [ ] Dashboard overview (KPIs, recent orders)
- [ ] Orders page (list, detail, fulfillment tracking)
- [ ] Products inventory management
- [ ] Payments & payouts view
- [ ] Customer CRM light
- [ ] Basic analytics (revenue, top products)

### Week 11–12: Automation & Polish
- [ ] Email notifications (n8n integration)
- [ ] SMS notifications (Twilio/Africa's Talking)
- [ ] Webhook signatures & retry logic
- [ ] Error handling & logging
- [ ] Security audit (PCI-DSS compliance)
- [ ] Performance optimization
- [ ] Testing & QA

---

## Key Decisions

### Payment Security
- ✅ PCI-DSS Level 1 (outsource sensitive handling to gateways)
- ✅ Webhook verification (HMAC signatures)
- ✅ No raw card storage on platform
- ✅ Environment variable secrets management

### Scalability
- ✅ Supabase connection pooling (PgBouncer)
- ✅ Edge caching with Cloudflare
- ✅ Asynchronous job queue (Bull/BullMQ for heavy tasks)
- ✅ Database indexing on common queries

### User Experience
- ✅ Mobile-first checkout (Framer Motion animations)
- ✅ Real-time order notifications
- ✅ One-click payment with saved payment methods
- ✅ Merchant dashboard responsive design

---

## Success Metrics (Phase 1)
- ✅ 100% uptime (99.9% SLA)
- ✅ <2s checkout load time
- ✅ <1% payment failure rate
- ✅ 24-hour KYC approval
- ✅ T+1 merchant payout
- ✅ <100ms API response times
- ✅ Full test coverage (unit + integration + e2e)

---

## Known Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Payment gateway integration delays | High | Start with sandbox, parallelize adapter work |
| KYC provider API reliability | High | Fallback to manual verification |
| Database performance | High | Connection pooling + early load testing |
| Security vulnerabilities | Critical | 3rd-party security audit pre-launch |
| User adoption | Medium | Free tier + in-app tutorials |

---

## Next Steps
1. Initialize monorepo with Turbo
2. Set up Supabase + Prisma
3. Implement NextAuth
4. Build payment adapter abstraction
5. Implement Ozow + Paystack adapters
6. Begin onboarding flow UI

---

*Last updated:* 2026-07-27
