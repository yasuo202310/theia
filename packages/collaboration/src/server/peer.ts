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

import { inject, injectable } from '@theia/core/shared/inversify';
import { v4 } from 'uuid';
import { BroadcastMessage, Message, ResponseMessage } from '../common/protocol';
import { Channel } from './channel';
import { MessageRelay } from './message-relay';
import { Peer, PeerInfo } from './types';

@injectable()
export class PeerImpl implements Peer {
    id: string;
    name: string;
    email?: string | undefined;
    channel: Channel;

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    constructor(info: PeerInfo) {
        this.id = v4();
        this.name = info.name;
        this.email = info.email;
        this.channel = info.channel;
        this.channel.onMessage(message => this.receiveMessage(message));
    }

    private async receiveMessage(message: Message): Promise<void> {
        if (Message.isResponse(message)) {
            this.messageRelay.pushResponse(this, message);
        } else if (Message.isRequest(message)) {
            const response = await this.messageRelay.sendRequest(this, message);
            const responseMessage: ResponseMessage = {
                id: message.id,
                version: message.version,
                kind: 'response',
                response
            };
            this.channel.sendMessage(responseMessage);
        } else if (Message.isNotification(message)) {
            this.messageRelay.sendNotification(this, message);
        } else if (BroadcastMessage.is(message)) {
            this.messageRelay.sendBroadcast(this, message);
        }
    }
}
