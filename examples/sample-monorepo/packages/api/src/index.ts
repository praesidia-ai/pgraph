import { createPayment } from "@example/domain";
export function checkout(amount: number): string {
  return createPayment(amount);
}
