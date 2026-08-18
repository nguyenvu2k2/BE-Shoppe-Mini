import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { UpdatePaymentStatusDto } from '../../common/dto/order/update-payment-status.dto';
import { CreateVnpayPaymentDto } from '../../common/dto/payment/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from '../../common/dto/payment/list-payments-query.dto';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { PaymentService } from './payment.service';
import { flattenVnpQuery, getClientIp } from '../../common/utils/vnpay.util';

const validateBody = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /**
   * VNPay IPN — no auth. Merchant portal must point to this public URL.
   * Always JSON { RspCode, Message }; do not treat this like a user API.
   * No ValidationPipe: VNPay sends many vnp_* fields we must keep for checksum.
   */
  @Get('vnpay/ipn')
  handleVnpayIpn(@Req() req: RequestWithCookies) {
    return this.paymentService.handleVnpayIpn(
      flattenVnpQuery(
        req.query as Record<string, string | string[] | undefined>,
      ),
    );
  }

  /**
   * VNPay return — browser lands here after paying.
   * HTML → redirect FE (no hash). JSON (Postman/FE fetch) → payload only.
   * Does not mark the order PAID.
   */
  @Get('vnpay/return')
  async handleVnpayReturn(
    @Req() req: RequestWithCookies,
    @Res() res: Response,
  ) {
    const result = await this.paymentService.handleVnpayReturn(
      flattenVnpQuery(
        req.query as Record<string, string | string[] | undefined>,
      ),
    );

    const accept = String(req.headers.accept ?? '');
    if (accept.includes('text/html')) {
      return res.redirect(result.redirectUrl);
    }

    return res.json(result);
  }

  /** Admin: danh sách mọi lần thanh toán. */
  @Get('manage')
  @AuthPermissions(PERMISSIONS.PAYMENT_READ)
  @UsePipes(validateBody)
  findManage(@Query() query: ListPaymentsQueryDto) {
    return this.paymentService.findManage(query);
  }

  /** Admin: xác nhận tay COD / chuyển khoản. Không dùng cho VNPay. */
  @Patch('manage/cod/:orderId')
  @AuthPermissions(PERMISSIONS.PAYMENT_UPDATE)
  @UsePipes(validateBody)
  confirmCod(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.paymentService.confirmManual(orderId, dto);
  }

  /** Khách: lịch sử thanh toán một đơn của mình. */
  @Get('orders/:orderId')
  @UseGuards(AuthGuard)
  findByOrderForUser(
    @CurrentUser('sub') userId: number,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.paymentService.findByOrderForUser(userId, orderId);
  }

  /** Khách: tạo URL VNPay cho một đơn UNPAID của mình. FE redirect sang paymentUrl. */
  @Post('vnpay/create')
  @UseGuards(AuthGuard)
  @UsePipes(validateBody)
  createVnpayUrl(
    @CurrentUser('sub') userId: number,
    @Body() dto: CreateVnpayPaymentDto,
    @Req() req: RequestWithCookies,
  ) {
    return this.paymentService.createVnpayUrl(
      userId,
      dto.orderId,
      getClientIp(req),
    );
  }
}
