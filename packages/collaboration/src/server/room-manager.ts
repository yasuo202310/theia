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
import { PeerJoined, RoomClosed, RoomJoin } from '../common/collaboration-messages';
import { BroadcastMessage, RequestMessage } from '../common/protocol';
import { MessageRelay } from './message-relay';
import { Peer, Permissions, Room, User } from './types';

@injectable()
export class RoomManager {

    protected rooms = new Map<string, Room>();
    protected peers = new Map<string, Room>();
    protected preparedRooms = new Map<string, string>();
    protected requestedJoins = new Map<string, string>();

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    closeRoom(id: string): void {
        const room = this.rooms.get(id);
        if (room) {
            this.messageRelay.sendBroadcast(room.host, BroadcastMessage.create(RoomClosed, room.host.id));
            for (const peer of room.peers) {
                this.peers.delete(peer.id);
            }
            this.rooms.delete(id);
        }
    }

    async prepareRoom(user: User): Promise<string> {
        const secret = v4();
        this.preparedRooms.set(user.id, secret);
        return secret;
    }

    async join(peer: Peer, id: string, secret: string): Promise<Room> {
        const hostSecret = this.preparedRooms.get(peer.user.id);
        if (!hostSecret) {
            const userSecret = this.requestedJoins.get(peer.user.id);
            if (userSecret !== secret) {
                throw new Error('Incorrect user secret provided');
            }
            this.requestedJoins.delete(peer.user.id);
            const room = this.rooms.get(id);
            if (!room) {
                throw new Error('Could not find room to join');
            }
            this.peers.set(peer.id, room);
            room.guests.push(peer);
            this.messageRelay.sendBroadcast(peer, BroadcastMessage.create(PeerJoined, peer.id, [peer.toProtocol()]));
            return room;
        } else {
            if (hostSecret !== secret) {
                throw new Error('Room is not prepared');
            }
            this.preparedRooms.delete(peer.user.id);
            const room = new RoomImpl(id, peer, {});
            this.rooms.set(room.id, room);
            this.peers.set(peer.id, room);
            console.log('Created room with id', room.id);
            peer.channel.onClose(() => {
                this.closeRoom(room.id);
            });
            return room;
        }
    }

    getRoomById(id: string): Room | undefined {
        return this.rooms.get(id);
    }

    getRoomByPeerId(id: string): Room | undefined {
        return this.peers.get(id);
    }

    async requestJoin(room: Room, user: User): Promise<string> {
        const response = await this.messageRelay.sendRequest(
            room.host,
            RequestMessage.create(RoomJoin, v4(), [user])
        ) as boolean;
        if (response) {
            const secret = v4();
            this.requestedJoins.set(user.id, secret);
            return secret;
        } else {
            throw new Error();
        }
    }

}

export class RoomImpl implements Room {
    id: string;
    host: Peer;
    guests: Peer[];
    permissions: Permissions;

    get peers(): Peer[] {
        return [this.host, ...this.guests];
    }

    constructor(id: string, host: Peer, permissions: Permissions) {
        this.id = id;
        this.host = host;
        this.permissions = permissions;
        this.guests = [];
    }
}
