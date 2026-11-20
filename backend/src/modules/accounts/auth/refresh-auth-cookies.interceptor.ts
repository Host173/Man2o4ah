import { Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { tap } from 'rxjs';
import type { Observable } from 'rxjs';
import { clearAuthCookies } from './auth-cookies.js';

@Injectable()
export class RefreshAuthCookiesInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          if (error instanceof UnauthorizedException) {
            clearAuthCookies(context.switchToHttp().getResponse<Response>());
          }
        },
      }),
    );
  }
}
