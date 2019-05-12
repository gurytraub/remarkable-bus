import { BaseListener } from './base_listener';
import Config from './config';
import { IConnection } from './connection';

export default class MessageListener extends BaseListener {
    constructor(connection: IConnection) {
        super(connection);

        this.exchangeName = Config.busExchangeName;
        this.exchangeType = 'topic';
    }

    async subscribe(topics: string[] | string) {
        if (typeof topics === 'string') { topics = [topics]; }

        await topics.map((topic: string) => {
            return this.connection.bindQueue(this.channel, this.queueName, this.exchangeName, topic, {});
        });
    }
}
