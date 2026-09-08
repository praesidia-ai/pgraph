export interface PaymentProvider {
  charge(amount: number): string;
}
export class StripeProvider implements PaymentProvider {
  charge(amount: number): string {
    return `payment:${amount}`;
  }
}
export const createPayment = (amount: number): string =>
  new StripeProvider().charge(amount);
