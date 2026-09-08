import { Injectable } from "@nestjs/common";
@Injectable()
export class AuthService {
  login(email: string): { email: string } {
    return { email };
  }
}
