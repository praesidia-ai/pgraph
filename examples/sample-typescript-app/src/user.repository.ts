export interface User {
  id: string;
  email: string;
  passwordHash: string;
  disabled: boolean;
}
export class UserRepository {
  private readonly users = new Map<string, User>();
  findByEmail(email: string): User | undefined {
    const normalized = email.trim().toLowerCase();
    return [...this.users.values()].find(
      (user) => user.email.toLowerCase() === normalized,
    );
  }
  save(user: User): void {
    if (!user.id || !user.email) throw new Error("User identity is required");
    this.users.set(user.id, { ...user });
  }
  disable(id: string): void {
    const user = this.users.get(id);
    if (!user) throw new Error("User not found");
    this.users.set(id, { ...user, disabled: true });
  }
}
