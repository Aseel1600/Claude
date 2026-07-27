# Vendo — African Commerce Platform

**Vendo** is a unified commerce platform enabling merchants across Africa to create online stores, accept payments, and manage their business with zero setup fees.

## 🚀 Quick Start

### Prerequisites
- Node.js ≥18.0.0
- npm or yarn
- PostgreSQL (for local development, or use Supabase)

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/vendo.git
cd vendo

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Set up database
npm run db:push

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 📁 Project Structure

```
vendo/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (auth)/                   # Authentication pages
│   │   ├── (merchant)/               # Merchant dashboard
│   │   ├── (store)/                  # Store builder
│   │   ├── api/                      # API routes
│   │   ├── checkout/                 # Checkout flow
│   │   └── layout.tsx                # Root layout
│   ├── components/                   # Reusable React components
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── store-builder/
│   │   ├── checkout/
│   │   └── ui/
│   ├── lib/                          # Utility functions
│   │   ├── payments/                 # Payment adapters
│   │   ├── auth/                     # Authentication
│   │   ├── db/                       # Database utilities
│   │   ├── hooks/                    # Custom React hooks
│   │   └── utils/                    # Helper functions
│   ├── types/                        # TypeScript types
│   └── styles/                       # Global styles
├── prisma/
│   └── schema.prisma                 # Database schema
├── public/                           # Static assets
├── .env.example                      # Environment variables template
├── next.config.js                    # Next.js configuration
├── tailwind.config.js                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
└── package.json
```

## 🏗️ Tech Stack

### Frontend
- **Framework:** Next.js 14 (App Router, SSR)
- **Styling:** Tailwind CSS v4
- **Animations:** Framer Motion
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts
- **UI Icons:** Lucide React

### Backend
- **Runtime:** Node.js + Express/Next.js API
- **Database:** PostgreSQL (Supabase)
- **ORM:** Prisma
- **Auth:** NextAuth.js (to implement)
- **Validation:** Zod

### Payment & Integrations
- **Payment Gateways:**
  - Ozow (ZA - EFT, no cards required)
  - Paystack (Pan-Africa - cards, bank transfers)
- **Email:** SendGrid / Resend
- **SMS:** Twilio / Africa's Talking
- **Deployment:** Vercel (frontend) + Supabase (backend)

## 📚 Key Features (Phase 1 MVP)

### ✅ Merchant Onboarding
- Email & Google OAuth registration
- Business details collection
- KYC/FICA verification
- Bank account connection
- Store creation wizard

### ✅ Store Builder
- Drag-and-drop store creation
- Pre-built templates
- Custom branding (logo, colors, banner)
- Product management
- Store preview and publishing

### ✅ Vendo Checkout
- PCI-DSS Level 1 compliant
- Mobile-first design
- Multiple payment methods
- Real-time payment processing
- Order confirmation & invoices

### ✅ Merchant Dashboard
- **Overview:** KPIs, revenue trends
- **Orders:** List, detail, fulfillment tracking
- **Products:** Inventory management
- **Customers:** Basic CRM
- **Payments:** Transaction history
- **Analytics:** Sales charts, top products

### ✅ Payment Processing
- Ozow & Paystack integration
- Webhook handling & verification
- T+1/T+2 merchant payouts
- Refund support

### ✅ Notifications
- Email notifications (order, payment, shipping)
- SMS alerts (optional)
- n8n automation workflows

## 🔑 Environment Variables

```bash
# Application
NEXT_PUBLIC_APP_NAME=Vendo
NEXT_PUBLIC_API_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/vendo_dev
SHADOW_DATABASE_URL=postgresql://user:password@localhost:5432/vendo_dev_shadow

# NextAuth
NEXTAUTH_SECRET=your-secret-key
NEXTAUTH_URL=http://localhost:3000

# Payment Gateways
OZOW_API_KEY=your-key
PAYSTACK_SECRET_KEY=your-key

# Email & SMS
SENDGRID_API_KEY=your-key
TWILIO_ACCOUNT_SID=your-id
```

## 🛠️ Development Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run production server
npm start

# Type check
npm run type-check

# Format code
npm run format

# Lint code
npm run lint

# Database management
npm run db:push        # Push schema changes
npm run db:migrate     # Create a migration
npm run db:studio      # Open Prisma Studio
```

## 🧪 Testing

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 📊 Database Schema

### Core Tables
- **Users** — Platform users (merchants, admins)
- **Businesses** — Merchant business info & KYC status
- **Stores** — Merchant storefronts
- **Products** — Inventory
- **Orders** — Customer orders
- **Payments** — Payment transactions
- **Transactions** — Settlement records
- **Invoices** — Invoicing
- **API Keys** — 3rd-party API access
- **Webhooks** — Merchant webhook endpoints
- **AuditLogs** — Compliance & audit trail

See `prisma/schema.prisma` for the full schema.

## 🔐 Security

- **PCI-DSS Level 1** — No raw card storage
- **Webhook signatures** — HMAC verification
- **Environment variables** — Secrets management
- **Input validation** — Zod schemas
- **SQL injection protection** — Prisma ORM
- **CORS enabled** — Configurable origins

## 🚀 Deployment

### Frontend (Vercel)
```bash
npm run build
vercel deploy
```

### Backend (Supabase)
- PostgreSQL database hosted on Supabase
- Environment variables configured in Vercel
- Auto-deployments on git push

### DNS & CDN (Cloudflare)
- Route53 or Cloudflare for DNS
- Edge caching for static assets
- DDoS protection

## 📖 API Documentation

### Authentication
- `POST /api/auth/register` — Register merchant
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout
- `POST /api/auth/refresh` — Refresh token

### Products
- `GET /api/products` — List products
- `POST /api/products` — Create product
- `PUT /api/products/:id` — Update product
- `DELETE /api/products/:id` — Delete product

### Orders
- `GET /api/orders` — List orders
- `GET /api/orders/:id` — Get order details
- `PUT /api/orders/:id` — Update order status
- `POST /api/orders/:id/refund` — Refund order

### Payments
- `POST /api/payments/initiate` — Initiate payment
- `GET /api/payments/:id` — Get payment status
- `POST /api/webhooks/payments` — Payment webhook

See full API docs in `docs/API.md` (to be created).

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Commit your changes: `git commit -m 'feat: add my feature'`
3. Push to the branch: `git push origin feat/my-feature`
4. Open a Pull Request

See `CONTRIBUTING.md` for guidelines.

## 📋 Roadmap

### Phase 1: MVP (8–12 weeks) ✅ In Progress
- Store builder
- Checkout
- Payment processing (Ozow, Paystack)
- Merchant dashboard
- Merchant onboarding + KYC
- Email/SMS notifications

### Phase 2: Growth (4–6 weeks)
- Payment links
- Invoicing
- Analytics dashboard
- Subscriptions
- Coupons & discounts
- Multi-gateway routing

### Phase 3: AI + Expansion (6–8 weeks)
- Vendo AI assistant
- Vendo POS
- WhatsApp sales bot
- Delivery integrations
- Multi-country rollout
- Mobile app (React Native)

### Phase 4: Platform (8–12 weeks)
- Developer API + docs
- Plugin marketplace
- Vendo Capital (BNPL)
- Vendo Payroll
- Vendo Terminal
- Vendo Banking

## 📧 Support

For support, email support@vendo.africa or join our community Slack.

## 📄 License

MIT License — see `LICENSE` for details.

## 👨‍💼 Authors

- Vendo Team

---

**Built with ❤️ for African merchants**
