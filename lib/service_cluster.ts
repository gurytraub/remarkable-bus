import MessageService, { IMessageService } from './message_service';
import { IContext } from './context';
import { Logger } from './logger';
import * as express from 'express';

// static proto interface, the instance interface is IMessageService
export type ServiceType<T extends MessageService> = {
    new (context: IContext): T
};

interface ServiceEntry {
    service: MessageService;
    httpPath?: string;
}

export default class ServiceCluster {
    private context: IContext;
    private services: ServiceEntry[];

    constructor(context: IContext) {
        this.services = [];
        this.context = context;
    }

    public use<T extends MessageService>(Service: ServiceType<T>, httpPath?: string, count?: number): T {
        let service = <T>(new Service(this.context));
        this.context.factory.parse(service.Proto, service.ServiceName);
        if (count === undefined) {
            count = 1; // default to 1 instance
        }
        for (let i = 0; i < count; ++i) {
            this.services.push({ service, httpPath });
            service = <T>(new Service(this.context));
        }
        return service;
    }

    public async routeHttp(_httpApp?: express.Express): Promise<express.Express> {
        const httpApp = _httpApp || express();
        for (let i = 0; i < this.services.length; ++i) {
            const { service, httpPath } = this.services[i];
            const subHttpApp = await service.routeHttp();
            if (subHttpApp) {
                Logger.info(`routing service class ${service.ServiceName}`);
                httpPath ? httpApp.use(httpPath, subHttpApp) : httpApp.use(subHttpApp);
            }
        }
        return httpApp;
    }

    public async init() {
        for (let i = 0; i < this.services.length; ++i) {
            const { service } = this.services[i];
            Logger.info(`initializing service class ${service.ServiceName}`);
            await service.init();
        }
    }

    public get ServiceNames(): string[] {
        return this.services.map(e => e.service.ServiceName);
    }
}