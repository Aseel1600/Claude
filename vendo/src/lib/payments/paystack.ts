import axios from 'axios';
import crypto from 'crypto';
import { IPaymentAdapter, PaymentConfig, PaymentInitResponse, PaymentVerifyResponse, RefundResponse, WebhookPayload } from './adapter';

export class PaystackAdapter implements IPaymentAdapter {
  provider = 'PAYSTACK' as const;
  private secretKey = process.env.PAYSTACK_SECRET_KEY || '';
  private apiUrl = 'https://api.paystack.co';
  private webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET || '';

  async initiate(config: PaymentConfig): Promise<PaymentInitResponse> {
    try {
      const response = await axios.post(`${this.apiUrl}/transaction/initialize`, {
        amount: Math.round(config.amount * 100), // Convert to cents
        email: config.customerEmail,
        metadata: {
          orderId: config.orderId,
          customerName: config.customerName,
          ...config.metadata,
        },
        currency: this.mapCurrency(config.currency),
        callback_url: `${config.returnUrl}?orderId=${config.orderId}`,
      }, {
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      const { access_code, authorization_url, reference } = response.data.data;

      return {
        transactionId: reference,
        paymentUrl: authorization_url,
        redirectUrl: `${this.apiUrl}/pay/${access_code}`,
      };
    } catch (error) {
      console.error('[Paystack] Initiate payment error:', error);
      throw new Error(`Paystack payment initiation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async verify(transactionId: string): Promise<PaymentVerifyResponse> {
    try {
      const response = await axios.get(`${this.apiUrl}/transaction/verify/${transactionId}`, {
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
        },
      });

      const { status, amount, reference } = response.data.data;

      return {
        transactionId,
        status: status === 'success' ? 'SUCCESS' : 'FAILED',
        amount: amount / 100, // Convert from cents
        reference,
      };
    } catch (error) {
      console.error('[Paystack] Verify payment error:', error);
      throw new Error('Payment verification failed');
    }
  }

  async refund(transactionId: string, amount: number): Promise<RefundResponse> {
    try {
      const response = await axios.post(`${this.apiUrl}/refund`, {
        transaction: transactionId,
        amount: Math.round(amount * 100), // Convert to cents
      }, {
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      return {
        success: response.data.status === true,
        refundId: response.data.data.refund_id,
        status: response.data.data.status,
      };
    } catch (error) {
      console.error('[Paystack] Refund error:', error);
      throw new Error('Refund failed');
    }
  }

  parseWebhook(payload: Record<string, any>): WebhookPayload {
    const data = payload.data || {};
    return {
      transactionId: data.reference,
      orderId: data.metadata?.orderId || '',
      status: data.status === 'success' ? 'SUCCESS' : 'FAILED',
      amount: data.amount / 100, // Convert from cents
      reference: data.reference,
      timestamp: new Date(data.paid_at || new Date()),
    };
  }

  verifyWebhookSignature(payload: string, signature: string, _secret: string): boolean {
    const hash = crypto.createHmac('sha512', this.secretKey).update(payload).digest('hex');
    return hash === signature;
  }

  private mapCurrency(currency: string): string {
    // Paystack supported currencies
    const currencyMap: Record<string, string> = {
      ZAR: 'ZAR',
      NGN: 'NGN',
      GHS: 'GHS',
      KES: 'KES',
      USD: 'USD',
      GBP: 'GBP',
      EUR: 'EUR',
    };
    return currencyMap[currency] || 'ZAR';
  }
}
