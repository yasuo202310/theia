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

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { nanoid } from 'nanoid';
import * as protocol from '../common/collaboration-types';
import { BroadcastMessage, Message, NotificationMessage, RequestMessage, ResponseErrorMessage, ResponseMessage } from '../common/protocol';
import { Channel } from './channel';
import { MessageRelay } from './message-relay';
import { RoomManager } from './room-manager';
import { Peer, PeerInfo, Room, User } from './types';

export const PeerFactory = Symbol('PeerFactory');
export type PeerFactory = (info: PeerInfo) => Peer;

@injectable()
export class PeerImpl implements Peer {

    readonly id = nanoid(24);

    get user(): User {
        return this.peerInfo.user;
    }

    get channel(): Channel {
        return this.peerInfo.channel;
    }

    get room(): Room {
        const value = this.roomManager.getRoomByPeerId(this.id);
        if (!value) {
            throw new Error("This peer doesn't belong to any room");
        }
        return value;
    }

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    @inject(PeerInfo)
    private readonly peerInfo: PeerInfo;

    @inject(RoomManager)
    private readonly roomManager: RoomManager;

    @postConstruct()
    protected init(): void {
        this.channel.onMessage(message => this.receiveMessage(message));
    }

    private async receiveMessage(message: Message): Promise<void> {
        if (ResponseMessage.is(message) || ResponseErrorMessage.is(message)) {
            this.messageRelay.pushResponse(this, message);
        } else if (RequestMessage.is(message)) {
            try {
                const response = await this.messageRelay.sendRequest(this.room.host, message);
                const responseMessage: ResponseMessage = {
                    id: message.id,
                    version: message.version,
                    kind: 'response',
                    response
                };
                this.channel.sendMessage(responseMessage);
            } catch (err) {
                const errorResponseMessage = ResponseErrorMessage.create(message.id, err.message);
                this.channel.sendMessage(errorResponseMessage);
            }
        } else if (NotificationMessage.is(message)) {
            this.messageRelay.sendNotification(this.room.host, message);
        } else if (BroadcastMessage.is(message)) {
            this.messageRelay.sendBroadcast(this, message);
        }
    }

    toProtocol(): protocol.Peer {
        return {
            id: this.id,
            name: this.user.name,
            email: this.user.email
        };
    }
}
