import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MongoExceptionFilter } from './exceptions/mongo.exception';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  const origins = configService
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Use AllExceptionsFilter first for comprehensive error handling
  app.useGlobalFilters(new AllExceptionsFilter(), new MongoExceptionFilter());

  // Add logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.setGlobalPrefix('api');

  const port = Number(configService.get<string>('PORT') || 3000);
  const nodeEnv = configService.get<string>('NODE_ENV') || 'development';

  // Log startup information
  logger.log('='.repeat(50));
  logger.log(`Environment: ${nodeEnv}`);
  logger.log(`Port: ${port}`);
  logger.log(`CORS Origins: ${origins.join(', ') || 'Not configured'}`);
  logger.log('='.repeat(50));

  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
  logger.log(`📝 Logging is enabled and working properly`);

  // Force flush logs immediately
  process.stdout.write('');
}

void bootstrap();
