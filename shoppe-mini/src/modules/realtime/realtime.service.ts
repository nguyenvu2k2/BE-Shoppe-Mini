import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
@Injectable()
export class RealtimeService {
    constructor(
        private readonly gateway: RealtimeGateway
    ) { }
    notifyOrderUpdated(userId: number, payload: any) {
        if (!userId || !payload) return;
        if (!this.gateway.server) return;
        try {
            this.gateway.server.to('user:' + userId).emit('orderUpdated', payload);
        } catch (error) {
            console.error('Error sending order update to user:', error);
        }

    }
}