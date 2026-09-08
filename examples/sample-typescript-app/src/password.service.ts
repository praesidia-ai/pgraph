import { scryptSync, timingSafeEqual } from "node:crypto";
export class PasswordService {
  verify(password: string, stored: string): boolean {
    const [salt, encoded] = stored.split(":");
    if (!salt || !encoded) return false;
    const expected = Buffer.from(encoded, "hex");
    if (expected.length !== 64) return false;
    return timingSafeEqual(scryptSync(password, salt, 64), expected);
  }
}
