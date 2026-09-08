import { randomBytes } from "node:crypto";
export interface Session {
  token: string;
  userId: string;
  expiresAt: number;
}
export class TokenService {
  private readonly sessions = new Map<string, Session>();
  issue(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, {
      token,
      userId,
      expiresAt: Date.now() + 3_600_000,
    });
    return token;
  }
  resolve(token: string): Session | undefined {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }
  revoke(token: string): void {
    this.sessions.delete(token);
  }
  revokeUser(userId: string): number {
    let revoked = 0;
    for (const [token, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(token);
        revoked++;
      }
    }
    return revoked;
  }
}
