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
import { Messages } from '../common/collaboration-messages';
import { BroadcastMessage, NotificationMessage, RequestMessage } from '../common/protocol';
import { CredentialsManager } from './credentials-manager';
import { MessageRelay } from './message-relay';
import { Peer, Room, User } from './types';

export interface PreparedRoom {
    id: string
    jwt: string;
}

export interface RoomClaim {
    room: string
    user: User
    host?: boolean
}

@injectable()
export class RoomManager {

    protected rooms = new Map<string, Room>();
    protected peers = new Map<string, Room>();

    @inject(MessageRelay)
    private readonly messageRelay: MessageRelay;

    @inject(CredentialsManager)
    protected readonly credentials: CredentialsManager;

    closeRoom(id: string): void {
        const room = this.rooms.get(id);
        if (room) {
            this.messageRelay.sendBroadcast(room.host, BroadcastMessage.create(Messages.Room.Closed, room.host.id));
            for (const peer of room.peers) {
                this.peers.delete(peer.id);
                peer.channel.close();
            }
            this.rooms.delete(id);
        }
    }

    async prepareRoom(user: User): Promise<PreparedRoom> {
        const id = this.credentials.secureId();
        const claim: RoomClaim = { room: id, user: { ...user }, host: true };
        const jwt = await this.credentials.generateJwt(claim);
        return {
            id,
            jwt
        };
    }

    async join(peer: Peer, roomId: string, host: boolean): Promise<Room> {
        let room: Room;
        if (host) {
            room = new RoomImpl(roomId, peer);
            this.rooms.set(room.id, room);
            this.peers.set(peer.id, room);
            console.log('Created room with id', room.id);
            peer.channel.onClose(() => {
                this.closeRoom(room.id);
            });
        } else {
            room = this.rooms.get(roomId)!;
            if (!room) {
                throw new Error('Could not find room to join');
            }
            this.peers.set(peer.id, room);
            room.guests.push(peer);
            this.messageRelay.sendBroadcast(
                peer,
                BroadcastMessage.create(
                    Messages.Room.Joined,
                    peer.id,
                    [peer.toProtocol()]
                )
            );
            peer.channel.onClose(() => {
                this.messageRelay.sendBroadcast(
                    peer,
                    BroadcastMessage.create(
                        Messages.Room.Left,
                        peer.id,
                        [peer.toProtocol()]
                    )
                );
            });
        }
        this.messageRelay.sendNotification(
            peer,
            NotificationMessage.create(
                Messages.Peer.Info,
                [peer.toProtocol()]
            )
        );
        return room;
    }

    getRoomById(id: string): Room | undefined {
        return this.rooms.get(id);
    }

    getRoomByPeerId(id: string): Room | undefined {
        return this.peers.get(id);
    }

    async requestJoin(room: Room, user: User): Promise<string> {
        try {
            const response = await this.messageRelay.sendRequest(
                room.host,
                RequestMessage.create(Messages.Peer.Join, this.credentials.secureId(), [user])
            ) as boolean;
            if (response) {
                const claim: RoomClaim = {
                    room: room.id,
                    user: { ...user }
                };
                return this.credentials.generateJwt(claim);
            } else {
                throw new Error('Join request has been rejected');
            }
        } catch {
            throw new Error('Join request has timed out');
        }
    }

}

export class RoomImpl implements Room {
    id: string;
    host: Peer;
    guests: Peer[];

    get peers(): Peer[] {
        return [this.host, ...this.guests];
    }

    constructor(id: string, host: Peer) {
        this.id = id;
        this.host = host;
        this.guests = [];
    }
}
