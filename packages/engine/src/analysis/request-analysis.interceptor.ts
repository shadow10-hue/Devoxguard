import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { buildRequestContext, RequestContext } from './request-context';

@Injectable()
export class RequestAnalysisInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const requestId = uuidv4();

    const ctx: RequestContext = buildRequestContext({
      requestId,
      route: req.route?.path ?? req.originalUrl,
      method: req.method,
      params: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
      originIp: req.ip,
      // The host application is responsible for populating req.user
      // (see packages/api-demo's FakeAuthMiddleware for the demo's approach).
      authenticatedUser: req.user ?? null,
    });

    req.devoxGuardContext = ctx;

    return next.handle().pipe(
      tap((responseBody) => {
        req.devoxGuardResponseBody = responseBody;
      }),
    );
  }
}
