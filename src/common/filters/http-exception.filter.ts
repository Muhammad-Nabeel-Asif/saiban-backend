import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: typeof message === 'string' ? message : (message as any).message || message,
    };

    const isClientError = status >= 400 && status < 500;

    if (isClientError) {
      // 4xx: expected client errors (validation, not found, etc.) – log once at WARN, no stack
      this.logger.warn(
        `${request.method} ${request.url} - ${status} - ${JSON.stringify(errorResponse.message)}`,
      );
    } else {
      // 5xx / unknown: real server errors – full log and stack for debugging
      this.logger.error(
        `${request.method} ${request.url} - Status: ${status}`,
        exception instanceof Error ? exception.stack : 'Unknown error',
      );
      console.error('=== ERROR ===');
      console.error('Time:', new Date().toISOString());
      console.error('Method:', request.method);
      console.error('URL:', request.url);
      console.error('Status:', status);
      console.error('Error:', exception);
      console.error('=============');
    }

    response.status(status).json(errorResponse);
  }
}
