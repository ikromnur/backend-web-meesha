import crypto from 'crypto';
import { processTripayCallback } from '../src/payments/tripay.service';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    order: {
      findUnique: jest.fn(async () => ({
        id: 'o1',
        totalAmount: 1000,
        status: 'PENDING',
        paymentMethod: 'QRIS',
        userId: 'u1',
        user: { email: 'user@example.com' },
        orderItems: [],
        createdAt: new Date().toISOString(),
      })),
      update: jest.fn(async () => ({})),
    },
    cart: {
      deleteMany: jest.fn(async () => ({})),
    },
  },
}));

jest.mock('../src/utils/email.utils', () => ({
  __esModule: true,
  default: {
    sendInvoiceEmail: jest.fn(async () => ({})),
  },
}));

describe('Tripay Callback', () => {
  it('memverifikasi signature dan mengupdate order', async () => {
    process.env.TRIPAY_PRIVATE_KEY = 'secret-key';
    process.env.TRIPAY_MERCHANT_CODE = 'M123';
    const body = {
      merchant_ref: 'o1',
      status: 'PAID',
      amount: 1000,
      payment_method: 'QRIS',
      total_amount: 1000,
    };
    const raw = JSON.stringify(body);
    const signature = crypto
      .createHmac('sha256', process.env.TRIPAY_PRIVATE_KEY as string)
      .update(raw)
      .digest('hex');

    const result = await processTripayCallback(body as any, raw, signature);
    expect(result).toHaveProperty('ok', true);
  });
});
