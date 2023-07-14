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

import { v4 } from 'uuid';
import { RoomClosed } from '../common/collaboration-messages';
import { BroadcastMessage } from '../common/protocol';
import { Peer, Permissions, Room } from './types';

export class RoomManager {

    protected rooms = new Map<string, Room>();

    closeRoom(id: string): void {
        const room = this.rooms.get(id);
        if (room) {
            room.sendBroadcast(room.host, BroadcastMessage.create(RoomClosed, room.host.id));
            this.rooms.delete(id);
        }
    }

    createRoom(host: Peer): Room {
        const room = new RoomImpl(v4(), host, {});
        this.rooms.set(room.id, room);
        return room;
    }

}

export class RoomImpl implements Room {
    id: string;
    host: Peer;
    guests: Peer[];
    permissions: Permissions;

    constructor(id: string, host: Peer, permissions: Permissions) {
        this.id = id;
        this.host = host;
        this.permissions = permissions;
        this.guests = [];
    }

    sendBroadcast(origin: Peer, message: BroadcastMessage): void {
        for (const peer of [...this.guests, this.host]) {
            if (peer.id !== origin.id) {
                peer.sendBroadcast(origin, message);
            }
        }
    }
}
