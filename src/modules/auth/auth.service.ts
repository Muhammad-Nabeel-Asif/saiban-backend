import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { User } from '../../schemas/user.schema';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './auth.dto';
import { MailService } from '../mail/mail.service';
import { RateLimiter } from '../../common/utils/rate-limiter.util';

const FORGOT_PASSWORD_MESSAGE = 'If an account exists, a reset link has been sent.';
const PASSWORD_UPDATED_MESSAGE = 'Password updated successfully';

@Injectable()
export class AuthService {
  private readonly forgotPasswordLimiter = new RateLimiter();

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async register(registerDto: RegisterDto) {
    const isUser = await this.userModel.findOne({ email: registerDto.email });

    if (isUser) {
      throw new UnauthorizedException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = new this.userModel({
      ...registerDto,
      password: hashedPassword,
    });

    await user.save();

    const token = this.signToken(user);

    return {
      access_token: token,
      user: this.toUserResponse(user),
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.userModel.findOne({ email: loginDto.email });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.signToken(user);

    return {
      access_token: token,
      user: this.toUserResponse(user),
    };
  }

  async getMe(userId: string) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return { user: this.toUserResponse(user) };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto, clientIp?: string) {
    this.assertForgotPasswordRateLimit(forgotPasswordDto.email, clientIp);

    const user = await this.userModel.findOne({ email: forgotPasswordDto.email });

    if (user) {
      const { token, hash } = this.generateResetToken();
      const expiresAt = this.getResetTokenExpiry();

      await this.userModel.updateOne(
        { _id: user._id },
        { passwordResetToken: hash, passwordResetExpires: expiresAt },
      );

      const resetUrl = this.buildResetUrl(token);
      await this.mailService.sendPasswordResetEmail(user.email, resetUrl, user.name);
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const tokenHash = this.hashResetToken(resetPasswordDto.token);
    const user = await this.userModel.findOne({
      passwordResetToken: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.password, 10);

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          passwordResetToken: null,
          passwordResetExpires: null,
        },
        $inc: { tokenVersion: 1 },
      },
    );

    return { message: PASSWORD_UPDATED_MESSAGE };
  }

  async changePassword(userId: string, changePasswordDto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (changePasswordDto.currentPassword === changePasswordDto.newPassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    const updatedUser = await this.userModel
      .findByIdAndUpdate(
        user._id,
        {
          $set: {
            password: hashedPassword,
            passwordResetToken: null,
            passwordResetExpires: null,
          },
          $inc: { tokenVersion: 1 },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updatedUser) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return {
      message: PASSWORD_UPDATED_MESSAGE,
      access_token: this.signToken(updatedUser),
    };
  }

  async updateProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { name: updateProfileDto.name }, { returnDocument: 'after' })
      .exec();

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return { user: this.toUserResponse(user) };
  }

  private assertForgotPasswordRateLimit(email: string, clientIp?: string): void {
    const windowMs = Number(this.configService.get('FORGOT_PASSWORD_RATE_WINDOW_MS', 900_000));
    const maxPerEmail = Number(this.configService.get('FORGOT_PASSWORD_MAX_PER_EMAIL', 3));
    const maxPerIp = Number(this.configService.get('FORGOT_PASSWORD_MAX_PER_IP', 10));

    if (!this.forgotPasswordLimiter.check(`forgot:${email}`, maxPerEmail, windowMs)) {
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (clientIp && !this.forgotPasswordLimiter.check(`forgot-ip:${clientIp}`, maxPerIp, windowMs)) {
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private generateResetToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, hash: this.hashResetToken(token) };
  }

  private hashResetToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private getResetTokenExpiry(): Date {
    const hours = Number(this.configService.get('PASSWORD_RESET_EXPIRY_HOURS', 1));
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  private buildResetUrl(token: string): string {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
    return `${frontendUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
  }

  private signToken(user: User): string {
    return this.jwtService.sign({
      sub: user._id,
      email: user.email,
      role: user.role,
      tv: user.tokenVersion ?? 0,
    });
  }

  private toUserResponse(user: User) {
    return {
      id: user._id,
      name: user?.name || '',
      email: user.email,
      role: user.role,
    };
  }
}
