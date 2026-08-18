import { Module } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * Module đơn hàng: checkout từ giỏ, theo dõi và quản lý đơn.
 * PrismaService và JwtService đã global nên không cần import thêm.
 */
@Module({
  imports: [PaymentModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
