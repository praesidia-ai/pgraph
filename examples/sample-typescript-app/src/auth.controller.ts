import { AuthService } from "./auth.service.js";
export class AuthController {
  constructor(private auth: AuthService) {}
  login(body: { email: string; password: string }): { token: string } {
    if (!body.email || !body.password)
      throw new Error("Email and password are required");
    return { token: this.auth.login(body.email, body.password) };
  }
  logout(token: string): { ok: boolean } {
    this.auth.logout(token);
    return { ok: true };
  }
}
