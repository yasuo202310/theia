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

export const VERSION = '0.1.0';

/**
 * A collaboration message
 */
export interface Message {
    /**
     * Protocol version
     */
    version: string;
    kind: string;
}

export namespace Message {
    export function isNotification(message: unknown): message is NotificationMessage {
        return is(message) && message.kind === 'notification';
    }

    export function isRequest(message: unknown): message is RequestMessage {
        return is(message) && message.kind === 'request';
    }

    export function isResponse(message: unknown): message is ResponseMessage {
        return is(message) && message.kind === 'notification';
    }

    export function is(item: unknown): item is Message {
        const message = item as Message;
        return typeof message === 'object' && message && typeof message.version === 'string' && message.kind === 'string';
    }
}

/**
 * Request message
 */
export interface RequestMessage extends Message {
    /**
     * The request id.
     */
    id: number | string;
    kind: 'request';

    /**
     * The method to be invoked.
     */
    method: string;

    /**
     * The method's params.
     */
    params?: unknown[] | object;
}

export interface ResponseMessage extends Message {
    /**
     * The original request id.
     */
    id: number | string;
    kind: 'response';
    response: unknown;
}

export interface NotificationMessage extends Message {
    kind: 'notification';

    /**
     * The method to be invoked.
     */
    method: string;

    /**
     * The method's params.
     */
    params?: unknown[] | object;
}

export interface BroadcastMessage extends Message {
    kind: 'broadcast';

    /**
     * ID of peer who initiated the broadcast.
     */
    clientId: string;

    /**
     * The method to be invoked.
     */
    method: string;

    /**
     * The method's params.
     */
    params?: unknown[] | object;
}

export namespace BroadcastMessage {
    export function create(signature: MessageSignature, clientId: string, params?: BroadcastMessage['params']): BroadcastMessage {
        return {
            clientId,
            method: signature.method,
            kind: 'broadcast',
            version: VERSION,
            params
        };
    }
    export function is(message: unknown): message is BroadcastMessage {
        return Message.is(message) && message.kind === 'broadcast';
    }
}

export interface MessageSignature {
    method: string
}

export class AbstractMessageSignature implements MessageSignature {
    method: string;
    constructor(method: string) {
        this.method = method;
    }
}

export class BroadcastType<P> extends AbstractMessageSignature {
    public readonly _?: ['broadcast', P, void];
    constructor(method: string) {
        super(method);
    }
}

export class RequestType<P, R> extends AbstractMessageSignature {
    public readonly _?: ['request', P, R];
    constructor(method: string) {
        super(method);
    }
}

export class NotificationType<P> extends AbstractMessageSignature {
    public readonly _?: ['notification', P, void];
    constructor(method: string) {
        super(method);
    }
}
