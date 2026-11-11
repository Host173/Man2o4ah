import { Catch, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toErrorBody } from './error-body.js';

/**
 * Sends every error in the one shape of api-contract.md §3. Status 500 and
 * above is logged with its stack; the log is the only place the stack goes,
 * and nothing from the request body, cookies or headers is logged.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { statusCode, body } = toErrorBody(exception, request.originalUrl);

    if (statusCode >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Unknown exception',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(body);
  }
}
