import { HttpException } from '@nestjs/common';
import mongoose from 'mongoose';
import { ErrorCode } from './error-codes.js';

export interface ErrorDetail {
  field: string;
  message: string;
}

/** The one error shape of every non-2xx response (api-contract.md §3). */
export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
  path: string;
  timestamp: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDetailList(value: unknown): value is ErrorDetail[] {
  return Array.isArray(value);
}

/** The response's `message` (an array is joined with `; `), else the fallback. */
function messageOf(response: unknown, fallback: string): string {
  if (typeof response === 'string') return response;
  if (isRecord(response)) {
    const { message } = response;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) {
      return message
        .filter((part): part is string => typeof part === 'string')
        .join('; ');
    }
  }
  return fallback;
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return ErrorCode.ValidationFailed;
    case 401:
      return ErrorCode.NotAuthenticated;
    case 403:
      return ErrorCode.ForbiddenRole;
    case 404:
      return ErrorCode.NotFound;
    case 409:
      return ErrorCode.Conflict;
    default:
      return status >= 400 && status < 500
        ? ErrorCode.RequestFailed
        : ErrorCode.InternalError;
  }
}

/**
 * Turns anything that was thrown into the status and the body to send.
 * Pure: no logging, no request object. Never copies a stack trace or the
 * message of an unexpected error into the body.
 */
export function toErrorBody(
  exception: unknown,
  path: string,
  now = new Date(),
): { statusCode: number; body: ErrorBody } {
  const timestamp = now.toISOString();

  const build = (
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetail[],
  ): { statusCode: number; body: ErrorBody } => ({
    statusCode,
    body: {
      statusCode,
      code,
      message,
      ...(details ? { details } : {}),
      path,
      timestamp,
    },
  });

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const message = messageOf(response, exception.message);
    if (isRecord(response) && typeof response.code === 'string') {
      return build(
        status,
        response.code,
        message,
        isDetailList(response.details) ? response.details : undefined,
      );
    }
    return build(status, codeForStatus(status), message);
  }

  if (isRecord(exception) && exception.code === 11000) {
    const keyValue = exception.keyValue;
    const details = isRecord(keyValue)
      ? Object.keys(keyValue).map((field) => ({
          field,
          message: 'already exists',
        }))
      : undefined;
    return build(409, ErrorCode.Conflict, 'Duplicate value', details);
  }

  if (exception instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(exception.errors).map(([field, error]) => ({
      field,
      message: error.message,
    }));
    return build(400, ErrorCode.ValidationFailed, 'Validation failed', details);
  }

  if (exception instanceof mongoose.Error.CastError) {
    return build(400, ErrorCode.ValidationFailed, 'Invalid value', [
      { field: exception.path, message: 'invalid value' },
    ]);
  }

  return build(500, ErrorCode.InternalError, 'Internal server error');
}
