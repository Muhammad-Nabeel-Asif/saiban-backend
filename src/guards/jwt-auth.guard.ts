import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { User } from '../schemas/user.schema';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  tv?: number;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header format');
    }

    let payload: JwtPayload;

    try {
      payload = jwt.verify(token, this.configService.get('JWT_SECRET') as string) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.userModel.findById(payload.sub).select('tokenVersion isActive').lean();

    if (!user?.isActive) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const expectedVersion = user.tokenVersion ?? 0;
    const tokenVersion = payload.tv ?? 0;

    if (tokenVersion !== expectedVersion) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request['user'] = payload;
    return true;
  }
}
