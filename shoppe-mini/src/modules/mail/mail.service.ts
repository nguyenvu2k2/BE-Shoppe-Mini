import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.resend = null;
      this.logger.warn('RESEND_API_KEY not set — reset links will be logged to console');
      return;
    }

    this.resend = new Resend(apiKey);
  }

  async sendPasswordResetEmail(to: string, resetUrl: string) {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      'Shoppe Mini <onboarding@resend.dev>';
    const expiryMinutes =
      this.configService.get('PASSWORD_RESET_EXPIRY_MINUTES') ?? 30;
    const subject = 'Đặt lại mật khẩu Shoppe Mini';
    const text = [
      'Bạn vừa yêu cầu đặt lại mật khẩu.',
      '',
      `Nhấp vào liên kết sau (hết hạn sau ${expiryMinutes} phút):`,
      resetUrl,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua email này.',
    ].join('\n');

    if (!this.resend) {
      this.logger.log(`Password reset link for ${to}: ${resetUrl}`);
      return;
    }

    const { error, data } = await this.resend.emails.send({ from, to, subject, text });

    if (error) {
      this.logger.error(`Resend error: ${error.message}`);
      throw new InternalServerErrorException('Failed to send password reset email');
    }

    this.logger.log(`Password reset email sent to ${to} (id: ${data?.id})`);
  }
}
