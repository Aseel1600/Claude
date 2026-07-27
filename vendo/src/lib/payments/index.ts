import { PaymentProvider } from '@/types';
import { IPaymentAdapter } from './adapter';
import { OzowAdapter } from './ozow';
import { PaystackAdapter } from './paystack';

export class PaymentProviderFactory {
  private static adapters: Map<PaymentProvider, IPaymentAdapter> = new Map();

  static {
    // Initialize adapters
    this.adapters.set('OZOW', new OzowAdapter());
    this.adapters.set('PAYSTACK', new PaystackAdapter());
  }

  static getAdapter(provider: PaymentProvider): IPaymentAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Payment provider '${provider}' not supported`);
    }
    return adapter;
  }

  static getSupportedProviders(): PaymentProvider[] {
    return Array.from(this.adapters.keys());
  }

  static isProviderEnabled(provider: PaymentProvider): boolean {
    const envKey = `ENABLE_${provider}`;
    const enabled = process.env[envKey];
    return enabled !== 'false';
  }
}

export function getPaymentAdapter(provider: PaymentProvider): IPaymentAdapter {
  if (!PaymentProviderFactory.isProviderEnabled(provider)) {
    throw new Error(`Payment provider '${provider}' is not enabled`);
  }
  return PaymentProviderFactory.getAdapter(provider);
}
