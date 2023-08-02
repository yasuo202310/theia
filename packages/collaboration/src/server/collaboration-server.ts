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
import * as http from 'http';
import { Server } from 'socket.io';
import { SocketIoChannel } from './channel';
import { PeerImpl } from './peer';
import { RoomManager } from './room-manager';

export class CollaborationServer {

    @inject(RoomManager)
    protected readonly roomManager: RoomManager;

    startServer(args: Record<string, unknown>): void {
        const httpServer = http.createServer();
        const io = new Server(httpServer);
        io.on('connection', socket => {
            const headers = socket.request.headers;
            const name = headers['x-name'] as string;
            const email = headers['x-email'] as string | undefined;
            const roomId = headers['x-room'] as string | undefined;
            const channel = new SocketIoChannel(socket);
            const peer = new PeerImpl({
                name,
                email,
                channel
            });
            if (roomId) {
                const room = this.roomManager.getRoomById(roomId);
                this.roomManager.addGuest(room!, peer);
            } else {
                this.roomManager.createRoom(peer);
            }
        });
        httpServer.listen(Number(args.port), String(args.hostname));
    }

}
