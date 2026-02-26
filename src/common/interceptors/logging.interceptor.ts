import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body } = request;
    const now = Date.now();

    // Log incoming request
    this.logger.log(`→ ${method} ${url}`);

    // Log request body for POST/PATCH/PUT (excluding sensitive fields)
    if (['POST', 'PATCH', 'PUT'].includes(method)) {
      const sanitizedBody = this.sanitizeBody(body);
      this.logger.debug(`Request Body: ${JSON.stringify(sanitizedBody)}`);
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const duration = Date.now() - now;

          this.logger.log(`← ${method} ${url} ${statusCode} - ${duration}ms`);
        },
        error: (error) => {
          const duration = Date.now() - now;
          const status = error.status || 500;
          const isClientError = status >= 400 && status < 500;
          const log = isClientError
            ? this.logger.warn.bind(this.logger)
            : this.logger.error.bind(this.logger);
          log(`✗ ${method} ${url} ${status} - ${duration}ms - ${error.message}`);
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
    const sanitized = { ...body };

    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }

    return sanitized;
  }
}
