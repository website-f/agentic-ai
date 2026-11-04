import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { AccessDenied, BadRequest, NotFound, RuleBlocked } from '@prima/core';
import type { Response } from 'express';
import { UnknownUser } from './db';
import { randomUUID } from 'node:crypto';

/** Only fixed categories enter logs: PG details/rows, messages, stack/cause and arbitrary object fields may contain private data. */
function safeErrorCategory(err: unknown): string {
  try {
    const code = err && typeof err === 'object' ? Object.getOwnPropertyDescriptor(err, 'code')?.value : undefined;
    if (['23502', '23503', '23505', '23514'].includes(code)) return 'database_constraint';
    if (['40001', '40P01'].includes(code)) return 'database_concurrency';
    if (['08001', '08006', '57P01', '53300'].includes(code)) return 'database_unavailable';
    if (['42P01', '42703', '42501'].includes(code)) return 'database_configuration';
  } catch { /* Untrusted object/proxy access must not prevent the generic error response. */ }
  return 'unexpected';
}

/** Maps domain errors to HTTP. Rule blocks return the findings so the screen can show why. */
@Catch()
export class DomainErrors implements ExceptionFilter {
  private log = new Logger('DomainErrors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      res.status(err.getStatus()).json({ message: err.message });
    } else if (err instanceof RuleBlocked) {
      res.status(422).json({ message: err.message, findings: err.findings });
    } else if (err instanceof AccessDenied) {
      res.status(403).json({ message: err.message });
    } else if (err instanceof NotFound) {
      res.status(404).json({ message: err.message });
    } else if (err instanceof BadRequest) {
      res.status(400).json({ message: err.message });
    } else if (err instanceof UnknownUser) {
      res.status(401).json({ message: 'Sign in again.' });
    } else {
      this.log.error(`server_error reference=${randomUUID()} category=${safeErrorCategory(err)}`);
      res.status(500).json({ message: 'Something went wrong on the server. It has been logged.' });
    }
  }
}
