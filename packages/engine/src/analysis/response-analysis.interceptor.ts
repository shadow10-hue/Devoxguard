import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestContext } from './request-context';

/**
 * Runs after RequestAnalysisInterceptor in the interceptor chain and
 * attaches the resolved response body to the RequestContext built for
 * this request, so response-phase DSL rules (`response.*` paths, e.g.
 * excessive-exposure-profile) can evaluate against it.
 */
@Injectable()
export class ResponseAnalysisInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();

    return next.handle().pipe(
      tap((responseBody) => {
        const ctx: RequestContext | undefined = req.devoxGuardContext;
        if (ctx) {
          ctx.responseBody = responseBody;
        }
      }),
    );
  }
}
