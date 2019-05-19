import * as protobuf from 'protobufjs';
import * as express from 'express';
import * as request from 'supertest';
import { expect } from 'chai';

import Config from '../lib/config';
import ServiceProxy from '../lib/service_proxy';
import MessageService from '../lib/message_service';
import Context, { IContext } from '../lib/context';
import { Logger } from '../lib/logger';

const proto = `syntax = "proto3";
package Simple;

message Request {
    int32 num1 = 1;
    int32 num2 = 2;
}

message Response {
    int32 result = 1;
}

message Event {
    string message = 1;
}

message MultiEvent {
    int32 count = 1;
}

service Service {
    rpc simpleMethod(Simple.Request) returns(Simple.Response);
}`;
class TestService extends MessageService {
    constructor(context: IContext) {
        super(context, { maxConcurrent: 1 });
        Logger.info('simple service initialized');
    }

    public async init() {
        await super.init();
    }

    public get ServiceName(): string { return 'Simple.Service'; }
    public get ProtoFileName(): string { return ''; }
    public get Proto(): string { return proto; }

    public async simpleMethod(request: any): Promise<any> {
        if (!request.num1 || !request.num2)
            throw new Error('invalid_params');

        return {
            result: request.num1 + request.num2
        };
    }

    public async routeHttp(): Promise<express.Express> {
        const app = express();
        const proxy: any = new ServiceProxy(this.context, this.ServiceName);
        proxy.init();
        app.get('/simpleMethod', async (req: express.Request, res: express.Response) => {
            const num1 = parseInt(req.query.num1);
            const num2 = parseInt(req.query.num2);
            const result = await proxy.simpleMethod({ num1, num2 });
            res.json(result);
        });
        return app;
    }
}

const AMQP_CONNECTION_STRING = 'amqp://guest:guest@localhost:5672/';

describe('MessageService tests suite', () => {
    let theService: TestService;
    let client: any;
    let context: Context;

    before(async () => {
        try {
            context = new Context();
            await context.init(AMQP_CONNECTION_STRING, []);
            // load proto from string in a hacky way. got this idea from protobuf.js tests
            (<any>protobuf.parse).filename = 'simple.proto';
            context.factory.root = protobuf.parse(proto).root;
            // init the micro service instance
            theService = new TestService(context);
            await theService.init();
            // initiate the stub/prpxy class to this service
            client = new ServiceProxy(context, theService.ServiceName);
            await client.init();
        }
        catch (error) {
            console.error(error);
        }
    });

    it('should test an RPC call', async () => {
        const res = await client.simpleMethod({ num1: 1, num2: 2});
        expect(res).to.have.property('result', 3);
    });

    it('should test an Event call', () => {
        return new Promise(async (resolve) => {
            const handler = async (event): Promise<any> => {
                expect(event).to.have.property('message', 'hello');
                resolve();
            };
            await theService.subscribeEvent('Simple.Event', handler);
            await theService.publishEvent('Simple.Event', { message: 'hello' });
        });
    });

    it('should test * wildcard subscriptions', () => {
        return new Promise(async (resolve) => {
            let i = 1;
            const handler = async (event): Promise<any> => {
                expect(event).to.have.property('count', i);
                if (i++ == 2) resolve();
            };
            await theService.subscribeEvent('Simple.MultiEvent', handler, 'CUSTOM.*.TOPIC');
            await theService.publishEvent('Simple.MultiEvent', { count: 1 }, 'CUSTOM.1.TOPIC');
            await theService.publishEvent('Simple.MultiEvent', { count: 2 }, 'CUSTOM.2.TOPIC');
        });
    });

    it('should test error exceptions flowing back to client', async () => {
        try {
            const res = await client.simpleMethod({ no: 'yes' });
            throw('should not get here');
        } catch (error) {
            expect(error).to.have.property('message', 'invalid_params');
        }
    });

    it('should test http routing', async () => {
        const app = await theService.routeHttp();
        const res = await request(app).get(`/simpleMethod?num1=1&num2=9`);
        expect(res).to.have.property('status', 200);
        expect(res.body).to.have.property('result', 10);
    });

    it('should test TS interface export', async() => {
        const source = context.factory.exportTS('Simple.Service');
        expect(source).to.equal(
`export namespace Simple {
    export interface IRequest {
        num1?: (number | null);
        num2?: (number | null);
    }

    export interface IResponse {
        result?: (number | null);
    }


    export interface Service {
        simpleMethod(request: IRequest): Promise<IResponse>;
    }

}

`);
    });
});

