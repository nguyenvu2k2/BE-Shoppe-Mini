import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private ready = false;

  constructor(private readonly configService: ConfigService) {}

  get url(): string {
    return (
      this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379'
    );
  }

  isReady() {
    return this.ready && this.client != null;
  }

  async onModuleInit() {
    const client = createClient({ url: this.url });
    client.on('error', (err: Error) => {
      this.ready = false;
      this.logger.warn(`Redis error: ${err.message}`);
    });

    try {
      await client.connect();
      this.client = client as RedisClientType;
      this.ready = true;
      this.logger.log(`Redis connected (${this.url})`);
    } catch (err: unknown) {
      this.ready = false;
      this.logger.warn(
        `Redis unavailable (${this.url}) — cache/rate-limit/queue disabled. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.isReady() || !this.client) {
      return null;
    }

    try {
      const raw = await this.client.get(key);
      if (raw == null) {
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      this.logger.warn(
        `GET ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    if (!this.isReady() || !this.client) {
      return;
    }

    try {
      await this.client.set(key, JSON.stringify(value), { EX: ttlSec });
    } catch (err: unknown) {
      this.logger.warn(
        `SET ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getOrSetJson<T>(
    key: string,
    ttlSec: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.getJson<T>(key);
    if (cached != null) {
      return cached;
    }

    const fresh = await loader();
    await this.setJson(key, fresh, ttlSec);
    return fresh;
  }

  async del(key: string): Promise<void> {
    if (!this.isReady() || !this.client) {
      return;
    }
    try {
      await this.client.del(key);
    } catch (err: unknown) {
      this.logger.warn(
        `DEL ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** SCAN + DEL. Never KEYS (blocks Redis). */
  async delByPrefix(prefix: string): Promise<void> {
    if (!this.isReady() || !this.client) {
      return;
    }

    try {
      const keys: string[] = [];
      for await (const key of this.client.scanIterator({
        MATCH: `${prefix}*`,
        COUNT: 100,
      })) {
        keys.push(String(key));
      }
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `DEL prefix ${prefix} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async invalidateCatalog(): Promise<void> {
    await this.delByPrefix('shoppe:prod:');
    await this.delByPrefix('shoppe:cat:');
  }

  /**
   * INCR then set TTL on first hit. Returns the new count, or null if Redis is down
   * (caller should fail-open).
   */
  async incrWithTtl(key: string, ttlSec: number): Promise<number | null> {
    if (!this.isReady() || !this.client) {
      return null;
    }

    try {
      const count = await this.client.incr(key);
      if (count === 1) {
        await this.client.expire(key, ttlSec);
      }
      return count;
    } catch (err: unknown) {
      this.logger.warn(
        `INCR ${key} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
