import { UserRepository } from "./user.repository.js";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";
export class AuthService {
  constructor(
    private users: UserRepository,
    private passwords: PasswordService,
    private tokens: TokenService,
  ) {}
  login(email: string, password: string): string {
    const user = this.users.findByEmail(email);
    if (
      !user ||
      user.disabled ||
      !this.passwords.verify(password, user.passwordHash)
    ) {
      throw new Error("Invalid credentials");
    }
    return this.tokens.issue(user.id);
  }
  logout(token: string): void {
    this.tokens.revoke(token);
  }
}
