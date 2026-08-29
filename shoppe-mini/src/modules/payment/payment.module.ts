import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { OrderExpireScheduler } from './order-expire.scheduler';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [PaymentController],
  providers: [PaymentService, OrderExpireScheduler],
  exports: [PaymentService],
})
export class PaymentModule { }
