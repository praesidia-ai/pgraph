import { Controller, Post, Body } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("login")
  login(@Body() body: { email: string }) {
    return this.auth.login(body.email);
  }
}
