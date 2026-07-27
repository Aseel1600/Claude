import { PaymentProvider } from '@/types';

export interface IPaymentAdapter {
  provider: PaymentProvider;
  initiate(config: PaymentConfig): Promise<PaymentInitResponse>;
  verify(transactionId: string): Promise<PaymentVerifyResponse>;
  refund(transactionId: string, amount: number): Promise<RefundResponse>;
  parseWebhook(payload: Record<string, any>): WebhookPayload;
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
}

export interface PaymentConfig {
  orderId: string;
  amount: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  description?: string;
  returnUrl: string;
  metadata?: Record<string, any>;
}

export interface PaymentInitResponse {
  transactionId: string;
  paymentUrl: string;
  redirectUrl?: string;
}

export interface PaymentVerifyResponse {
  transactionId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount: number;
  reference: string;
}

export interface RefundResponse {
  success: boolean;
  refundId: string;
  status: string;
  message?: string;
}

export interface WebhookPayload {
  transactionId: string;
  orderId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount: number;
  reference: string;
  timestamp: Date;
}
