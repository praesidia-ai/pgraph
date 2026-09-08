export class AccountLockoutService {
  private readonly failures = new Map<
    string,
    { count: number; lastAttempt: number }
  >();
  isLocked(email: string, now = Date.now()): boolean {
    const state = this.failures.get(email.trim().toLowerCase());
    return !!state && state.count >= 5 && now - state.lastAttempt < 900_000;
  }
  recordFailure(email: string, now = Date.now()): void {
    const key = email.trim().toLowerCase();
    const previous = this.failures.get(key);
    const count =
      previous && now - previous.lastAttempt < 900_000 ? previous.count + 1 : 1;
    this.failures.set(key, { count, lastAttempt: now });
  }
  clear(email: string): void {
    this.failures.delete(email.trim().toLowerCase());
  }
}
