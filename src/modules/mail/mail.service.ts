import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  renderPasswordResetHtml,
  renderPasswordResetPlainText,
} from './templates/password-reset';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');

    if (!host) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get('SMTP_PORT', 587)),
      secure: this.configService.get('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
    userName?: string | null,
  ): Promise<void> {
    const from = this.configService.get<string>('SMTP_FROM', 'noreply@saiban.app');
    const subject = 'Reset your Saiban password';
    const expiryHours = Number(this.configService.get('PASSWORD_RESET_EXPIRY_HOURS', 1));
    const emailParams = { resetUrl, userName, expiryHours };

    const text = renderPasswordResetPlainText(emailParams);
    const html = renderPasswordResetHtml(emailParams);

    if (!this.transporter) {
      this.logger.warn(
        `SMTP not configured — password reset for ${to}:\n${renderPasswordResetPlainText(emailParams)}`,
      );
      return;
    }

    await this.transporter.sendMail({ from, to, subject, text, html });
  }
}
