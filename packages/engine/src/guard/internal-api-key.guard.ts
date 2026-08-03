import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { DEVOXGUARD_CONFIG, DevoxGuardConfig } from '../devoxguard-config';

const API_KEY_HEADER = 'x-devoxguard-api-key';

/**
 * Minimal auth for the internal dashboard endpoints (spec section 6):
 * a static API key checked against a header. Proportionate to a
 * stage/demo project — not meant to be a general-purpose auth system.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(@Inject(DEVOXGUARD_CONFIG) private readonly config: DevoxGuardConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const provided = req.headers[API_KEY_HEADER];

    if (!provided || provided !== this.config.apiKey) {
      throw new UnauthorizedException('Missing or invalid x-devoxguard-api-key header');
    }
    return true;
  }
}
