import { generateInvoicePdf } from '../src/utils/invoice.utils';

describe('Invoice PDF', () => {
  it('menghasilkan Buffer PDF valid', async () => {
    const order: any = {
      id: 'order-test',
      status: 'COMPLETED',
      paymentMethod: 'QRIS',
      totalAmount: 10000,
      createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(),
      shippingAddress: 'Alamat',
      pickupAt: undefined,
      user: { id: 'u1', email: 'user@example.com' },
      orderItems: [],
    };
    const buf = await generateInvoicePdf(order);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});
