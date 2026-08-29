import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { PaymentService } from './payment.service';

const QUEUE_NAME = 'order-expire';
const JOB_NAME = 'tick';
const EVERY_MS = 60 * 1000;

/**
 * One repeatable job for the whole stack (unlike setInterval per Nest process).
 * Falls back to setInterval when Redis is down.
 */
@Injectable()
export class OrderExpireScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpireScheduler.name);
  private queue?: Queue;
  private worker?: Worker;
  private fallbackTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly paymentService: PaymentService,
    private readonly redis: RedisService,
  ) {}

  async onApplicationBootstrap() {
    if (!this.redis.isReady()) {
      this.startFallback();
      return;
    }

    try {
      const connection = this.bullmqConnection();
      this.queue = new Queue(QUEUE_NAME, { connection });
      this.worker = new Worker(
        QUEUE_NAME,
        async () => {
          await this.paymentService.expireStaleOrders();
        },
        { connection: this.bullmqConnection(), concurrency: 1 },
      );

      this.worker.on('failed', (job, err) => {
        this.logger.error(
          `Expire job ${job?.id} failed: ${err.message}`,
          err.stack,
        );
      });

      await this.queue.add(
        JOB_NAME,
        {},
        {
          repeat: { every: EVERY_MS, key: 'order-expire-repeat' },
          removeOnComplete: 50,
          removeOnFail: 50,
        },
      );

      this.logger.log('Order expire scheduled on BullMQ (every 60s)');
    } catch (err: unknown) {
      this.logger.warn(
        `BullMQ unavailable, falling back to setInterval: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.startFallback();
    }
  }

  async onModuleDestroy() {
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
    }
    await this.worker?.close();
    await this.queue?.close();
  }

  private startFallback() {
    this.logger.warn('Order expire using in-process setInterval (no Redis)');
    this.fallbackTimer = setInterval(() => {
      void this.paymentService.expireStaleOrders().catch((err: unknown) => {
        this.logger.error(
          'Failed to expire stale unpaid orders',
          err instanceof Error ? err.stack : String(err),
        );
      });
    }, EVERY_MS);
    void this.paymentService.expireStaleOrders().catch((err: unknown) => {
      this.logger.error(
        'Failed to expire stale unpaid orders',
        err instanceof Error ? err.stack : String(err),
      );
    });
  }

  private bullmqConnection(): ConnectionOptions {
    const url = new URL(this.redis.url);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      maxRetriesPerRequest: null,
    };
  }
}
