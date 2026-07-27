// Payment provider types
export type PaymentProvider = 'OZOW' | 'PAYSTACK' | 'PEACH' | 'STRIPE';

export interface PaymentInitiateRequest {
  orderId: string;
  amount: number;
  currency: string;
  method: string;
  customerEmail: string;
  customerName: string;
  returnUrl: string;
}

export interface PaymentInitiateResponse {
  transactionId: string;
  paymentUrl: string;
  redirectUrl?: string;
  provider: PaymentProvider;
}

export interface PaymentVerificationResponse {
  transactionId: string;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  amount: number;
  reference: string;
  timestamp: Date;
}

export interface PaymentWebhookPayload {
  transactionId: string;
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount: number;
  reference: string;
  timestamp: Date;
}

// Store types
export interface StoreCreateRequest {
  name: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  theme?: Record<string, any>;
}

export interface StoreUpdateRequest extends Partial<StoreCreateRequest> {}

// Product types
export interface ProductCreateRequest {
  name: string;
  description?: string;
  price: number;
  costPrice?: number;
  quantity: number;
  sku?: string;
  images?: string[];
}

export interface ProductUpdateRequest extends Partial<ProductCreateRequest> {}

// Order types
export interface OrderCreateRequest {
  items: Array<{
    productId: string;
    quantity: number;
  }>;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  shippingFee?: number;
  notes?: string;
}

export interface OrderWithItems {
  id: string;
  storeId: string;
  customerEmail: string;
  customerName: string;
  total: number;
  status: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  createdAt: Date;
}

// Dashboard metrics
export interface DashboardMetrics {
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  pendingOrders: number;
  revenueGrowth: number;
  topProducts: Array<{
    name: string;
    sales: number;
    revenue: number;
  }>;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Auth types
export interface Session {
  user: {
    id: string;
    email: string;
    name?: string;
    role: 'ADMIN' | 'MERCHANT' | 'CUSTOMER';
  };
  expires: Date;
}
