import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { formatMoneyFieldsDeep } from '../utils/money.util';

@Injectable()
export class MonetaryPrecisionInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => formatMoneyFieldsDeep(data)));
  }
}
