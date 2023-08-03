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

import { injectable } from '@theia/core/shared/inversify';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { v4 } from 'uuid';
import { BroadcastMessage, NotificationMessage, RequestMessage, ResponseMessage } from '../common/protocol';
import { Peer } from './types';

export interface RelayedRequest {
    id: string | number;
    response: Deferred<unknown>
    dispose(): void;
}

@injectable()
export class MessageRelay {

    protected requestMap = new Map<string, RelayedRequest>();

    pushResponse(receiver: Peer, message: ResponseMessage): void {
        const relayedRequest = this.requestMap.get(message.id.toString());
        if (relayedRequest) {
            relayedRequest.response.resolve(message.response);
            relayedRequest.dispose();
        }
    }

    sendRequest(target: Peer, message: RequestMessage): Promise<unknown> {
        const deferred = new Deferred<unknown>();
        const messageId = message.id;
        const key = v4();
        this.requestMap.set(key, {
            id: messageId,
            response: deferred,
            dispose: () => {
                this.requestMap.delete(key);
            }
        });
        const targetMessage: RequestMessage = {
            ...message,
            id: key
        };
        target.channel.sendMessage(targetMessage);
        return deferred.promise;
    }

    sendNotification(target: Peer, message: NotificationMessage): void {
        target.channel.sendMessage(message);
    }

    sendBroadcast(origin: Peer, message: BroadcastMessage): void {
        const room = origin.room;
        if (!room) {
            throw new Error("Origin peer doesn't belong to any room");
        }
        message.clientId = origin.id;
        for (const peer of room.peers) {
            if (peer !== origin) {
                peer.channel.sendMessage(message);
            }
        }
    }

}
