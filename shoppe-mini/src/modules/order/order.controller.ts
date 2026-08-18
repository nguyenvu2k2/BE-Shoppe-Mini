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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { AuthPermissions } from '../../common/auth/auth-permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { RequestWithCookies } from '../../common/auth/request-with-cookies.type';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CancelOrderDto } from '../../common/dto/order/cancel-order.dto';
import { CreateOrderDto } from '../../common/dto/order/create-order.dto';
import { ListMyOrdersQueryDto } from '../../common/dto/order/list-my-orders-query.dto';
import { ListOrdersQueryDto } from '../../common/dto/order/list-orders-query.dto';
import { UpdateOrderStatusDto } from '../../common/dto/order/update-order-status.dto';
import { UpdatePaymentStatusDto } from '../../common/dto/order/update-payment-status.dto';
import { getClientIp } from '../../common/utils/vnpay.util';
import { OrderService } from './order.service';

@Controller('orders')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // ==================== ADMIN ====================
  // Lưu ý: các route "manage" phải khai báo trước route ":id"
  // vì NestJS match theo thứ tự, nếu không "manage" sẽ bị hiểu là :id

  /** Admin: xem tất cả đơn hàng */
  @Get('manage')
  @AuthPermissions(PERMISSIONS.ORDER_READ)
  findManage(@Query() query: ListOrdersQueryDto) {
    return this.orderService.findManage(query);
  }

  /** Admin: xem chi tiết một đơn bất kỳ */
  @Get('manage/:id')
  @AuthPermissions(PERMISSIONS.ORDER_READ)
  findOneForAdmin(@Param('id', ParseIntPipe) id: number) {
    return this.orderService.findOneForAdmin(id);
  }

  /** Admin: cập nhật trạng thái đơn (CONFIRMED / SHIPPING / COMPLETED) */
  @Patch('manage/:id/status')
  @AuthPermissions(PERMISSIONS.ORDER_UPDATE)
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.orderService.updateStatus(id, dto);
  }

  /** Admin: cập nhật trạng thái thanh toán (PAID / FAILED / REFUNDED) */
  @Patch('manage/:id/payment')
  @AuthPermissions(PERMISSIONS.ORDER_UPDATE)
  updatePaymentStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentStatusDto,
  ) {
    return this.orderService.updatePaymentStatus(id, dto);
  }

  /** Admin: hủy đơn hàng (khi PENDING hoặc CONFIRMED) */
  @Patch('manage/:id/cancel')
  @AuthPermissions(PERMISSIONS.ORDER_UPDATE)
  cancelByAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orderService.cancelByAdmin(id, dto);
  }

  // ==================== CUSTOMER ====================

  /** Khách: đặt hàng từ giỏ hàng. VNPAY thì response có vnpay.paymentUrl để redirect. */
  @Post()
  @UseGuards(AuthGuard)
  checkout(
    @CurrentUser('sub') userId: number,
    @Body() dto: CreateOrderDto,
    @Req() req: RequestWithCookies,
  ) {
    return this.orderService.checkout(userId, dto, getClientIp(req));
  }

  /** Khách: xem danh sách đơn hàng của mình */
  @Get()
  @UseGuards(AuthGuard)
  findMine(
    @CurrentUser('sub') userId: number,
    @Query() query: ListMyOrdersQueryDto,
  ) {
    return this.orderService.findMine(userId, query);
  }

  /** Khách: xem chi tiết một đơn hàng của mình */
  @Get(':id')
  @UseGuards(AuthGuard)
  findOneForUser(
    @CurrentUser('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orderService.findOneForUser(userId, id);
  }

  /** Khách: hủy đơn hàng của mình (chỉ khi còn PENDING) */
  @Patch(':id/cancel')
  @UseGuards(AuthGuard)
  cancelByUser(
    @CurrentUser('sub') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orderService.cancelByUser(userId, id, dto);
  }
}
