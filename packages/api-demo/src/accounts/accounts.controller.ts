import { Body, Controller, Post } from '@nestjs/common';
import { AccountsService, LoginResult } from './accounts.service';

@Controller('account')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /**
   * POST /account/login { email, password }. Deliberately vulnerable to
   * MongoDB operator injection: the raw body is used as the query filter (see
   * AccountsService.login). A normal object logs in; `{ "$ne": ... }` and
   * friends bypass the password check.
   */
  @Post('login')
  login(@Body() body: Record<string, unknown>): Promise<LoginResult> {
    return this.accountsService.login(body ?? {});
  }
}
