import axios from 'axios';
import crypto from 'crypto';
import { IPaymentAdapter, PaymentConfig, PaymentInitResponse, PaymentVerifyResponse, RefundResponse, WebhookPayload } from './adapter';

export class OzowAdapter implements IPaymentAdapter {
  provider = 'OZOW' as const;
  private apiKey = process.env.OZOW_API_KEY || '';
  private apiUrl = process.env.OZOW_API_URL || 'https://api.ozow.com';
  private webhookSecret = process.env.OZOW_WEBHOOK_SECRET || '';

  async initiate(config: PaymentConfig): Promise<PaymentInitResponse> {
    try {
      const response = await axios.post(`${this.apiUrl}/checkout/initialize`, {
        amount: config.amount,
        currency: config.currency,
        reference: config.orderId,
        customerName: config.customerName,
        customerEmail: config.customerEmail,
        successUrl: `${config.returnUrl}?status=success`,
        failUrl: `${config.returnUrl}?status=failed`,
        isTest: process.env.NODE_ENV === 'development',
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        transactionId: response.data.transactionId,
        paymentUrl: response.data.checkoutUrl,
      };
    } catch (error) {
      console.error('[Ozow] Initiate payment error:', error);
      throw new Error(`Ozow payment initiation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verify(transactionId: string): Promise<PaymentVerifyResponse> {
    try {
      const response = await axios.get(`${this.apiUrl}/transactions/${transactionId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      const { status, amount, reference } = response.data;

      return {
        transactionId,
        status: status === 'Complete' ? 'SUCCESS' : status === 'Failed' ? 'FAILED' : 'PENDING',
        amount,
        reference,
      };
    } catch (error) {
      console.error('[Ozow] Verify payment error:', error);
      throw new Error('Payment verification failed');
    }
  }

  async refund(transactionId: string, amount: number): Promise<RefundResponse> {
    try {
      const response = await axios.post(`${this.apiUrl}/transactions/${transactionId}/refund`, {
        amount,
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: response.data.success,
        refundId: response.data.refundId,
        status: response.data.status,
      };
    } catch (error) {
      console.error('[Ozow] Refund error:', error);
      throw new Error('Refund failed');
    }
  }

  parseWebhook(payload: Record<string, any>): WebhookPayload {
    return {
      transactionId: payload.transactionId,
      orderId: payload.reference,
      status: payload.status === 'Complete' ? 'SUCCESS' : payload.status === 'Failed' ? 'FAILED' : 'PENDING',
      amount: payload.amount,
      reference: payload.reference,
      timestamp: new Date(payload.createdAt),
    };
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return hash === signature;
  }
}
