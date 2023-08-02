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

import { inject } from '@theia/core/shared/inversify';
import { v4 } from 'uuid';
import { PeerJoined, RoomClosed } from '../common/collaboration-messages';
import { BroadcastMessage } from '../common/protocol';
import { MessageRelay } from './message-relay';
import { Peer, Permissions, Room } from './types';

export class RoomManager {

    protected rooms = new Map<string, Room>();
    protected peers = new Map<string, Room>();

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

    createRoom(host: Peer): Room {
        const room = new RoomImpl(v4(), host, {});
        this.rooms.set(room.id, room);
        this.peers.set(host.id, room);
        return room;
    }

    getRoomById(id: string): Room | undefined {
        return this.rooms.get(id);
    }

    getRoomByPeerId(id: string): Room | undefined {
        return this.peers.get(id);
    }

    addGuest(room: Room, peer: Peer): void {
        this.peers.set(peer.id, room);
        room.guests.push(peer);
        this.messageRelay.sendBroadcast(peer, BroadcastMessage.create(PeerJoined, peer.id, [peer]));
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
