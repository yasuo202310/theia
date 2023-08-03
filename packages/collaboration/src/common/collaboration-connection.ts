// *****************************************************************************
// Copyright (C) 2023 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Deferred } from '@theia/core/lib/common/promise-util';
import { BroadcastMessage, BroadcastType, Message, NotificationMessage, NotificationType, RequestMessage, RequestType, ResponseMessage } from './protocol';

export type Handler<P extends unknown[], R = void> = (...parameters: P) => (R | Promise<R>);

export interface CollaborationConnection {
    onRequest<P extends unknown[], R>(type: RequestType<P, R>, handler: Handler<P, R>): void;
    onNotification<P extends unknown[]>(type: NotificationType<P>, handler: Handler<P>): void;
    onBroadcast<P extends unknown[]>(type: BroadcastType<P>, handler: Handler<P>): void;
    sendRequest<P extends unknown[], R>(type: RequestType<P, R>, ...parameters: P): Promise<R>;
    sendNotification<P extends unknown[]>(type: NotificationType<P>, ...parameters: P): void;
    sendBroadcast<P extends unknown[]>(type: BroadcastType<P>, ...parameters: P): void;
}

export type ConnectionWriter = (data: unknown) => void;
export type ConnectionReader = (cb: (data: unknown) => void) => void;

export interface RelayedRequest {
    id: string | number;
    response: Deferred<unknown>
    dispose(): void;
}

export class Connection implements CollaborationConnection {

    protected messageHandlers = new Map<string, Function>();
    protected requestMap = new Map<string | number, RelayedRequest>();
    protected requestId = 1;

    constructor(readonly writer: ConnectionWriter, readonly reader: ConnectionReader) {
        reader(data => this.handleMessage(data));
    }

    protected handleMessage(message: unknown): void {
        if (Message.is(message)) {
            if (ResponseMessage.is(message)) {
                const id = message.id;
                const request = this.requestMap.get(id);
                if (request) {
                    request.response.resolve(message.response);
                }
            } else if (RequestMessage.is(message)) {
                const handler = this.messageHandlers.get(message.method);
                if (!handler) {
                    throw new Error(`No handler registered for ${message.kind} method ${message.method}.`);
                }
                const result = handler(...(message.params ?? []));
                Promise.resolve(result).then(value => {
                    const responseMessage = ResponseMessage.create(message.id, value);
                    this.writer(responseMessage);
                });
            } else if (BroadcastMessage.is(message) || NotificationMessage.is(message)) {
                const handler = this.messageHandlers.get(message.method);
                if (!handler) {
                    throw new Error(`No handler registered for ${message.kind} method ${message.method}.`);
                }
                handler(...(message.params ?? []));
            }
        }
    }

    onRequest<P extends unknown[], R>(type: RequestType<P, R>, handler: Handler<P, R>): void {
        this.messageHandlers.set(type.method, handler);
    }

    onNotification<P extends unknown[]>(type: NotificationType<P>, handler: Handler<P>): void {
        this.messageHandlers.set(type.method, handler);
    }

    onBroadcast<P extends unknown[]>(type: BroadcastType<P>, handler: Handler<P>): void {
        this.messageHandlers.set(type.method, handler);
    }

    sendRequest<P extends unknown[], R>(type: RequestType<P, R>, ...parameters: P): Promise<R> {
        const id = this.requestId++;
        const deferred = new Deferred<R>();
        const relayedMessage: RelayedRequest = {
            id,
            response: deferred,
            dispose: () => this.requestMap.delete(id)
        };
        this.requestMap.set(id, relayedMessage);
        const message = RequestMessage.create(type, this.requestId++, parameters);
        this.writer(message);
        return deferred.promise;
    }

    sendNotification<P extends unknown[]>(type: NotificationType<P>, ...parameters: P): void {
        const message = NotificationMessage.create(type, parameters);
        this.writer(message);
    }

    sendBroadcast<P extends unknown[]>(type: BroadcastType<P>, ...parameters: P): void {
        const message = BroadcastMessage.create(type, '', parameters);
        this.writer(message);
    }
}
