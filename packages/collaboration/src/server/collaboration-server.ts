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
import * as http from 'http';
import { Server } from 'socket.io';
import * as express from '@theia/core/shared/express';
import { SocketIoChannel } from './channel';
import { PeerFactory } from './peer';
import { RoomManager } from './room-manager';
import { UserManager } from './user-manager';
import { v4 } from 'uuid';
import { CredentialsManager } from './credentials-manager';

@injectable()
export class CollaborationServer {

    @inject(RoomManager)
    protected readonly roomManager: RoomManager;

    @inject(UserManager)
    protected readonly userManager: UserManager;

    @inject(CredentialsManager)
    protected readonly credentials: CredentialsManager;

    @inject(PeerFactory)
    protected readonly peerFactory: PeerFactory;

    startServer(args: Record<string, unknown>): void {
        const httpServer = http.createServer(this.setupApiRoute());
        const io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        io.on('connection', async socket => {
            console.log('Received connection');
            const headers = socket.request.headers;
            const auth = headers.authorization as string;
            const user = await this.credentials.getUser(auth);
            console.log('User connection: ', user);
            if (!user) {
                socket.disconnect(true);
                return;
            }
            const roomId = headers['x-room'] as string;
            const roomSecret = headers['x-secret'] as string;
            const channel = new SocketIoChannel(socket);
            const peer = this.peerFactory({
                user,
                channel
            });
            console.log('Registered connection', {
                user,
                roomId,
                roomSecret
            });
            try {
                await this.roomManager.join(peer, roomId, roomSecret);
            } catch (err) {
                socket.disconnect(true);
                console.log(err);
            }
        });
        httpServer.listen(Number(args.port), String(args.hostname));
    }

    protected setupApiRoute(): express.Application {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            next();
        });
        app.post('/api/user/login', async (req, res) => {
            try {
                const name = req.body.name as string;
                const email = req.body.email as string | undefined;
                const user = await this.userManager.registerUser({
                    name,
                    email
                });
                const token = await this.credentials.assignAuthToken(user);
                res.send({
                    user: user.id,
                    token
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err);
            }
        });
        app.post('/api/session/join', async (req, res) => {
            try {
                const userId = req.body.user as string;
                const roomId = req.body.room as string;
                const user = await this.userManager.getUser(userId);
                const room = this.roomManager.getRoomById(roomId);
                if (!room) {
                    throw new Error(`Room with requested id ${roomId} does not exist`);
                }
                const roomSecret = await this.roomManager.requestJoin(room, user!);
                res.send({
                    room: roomId,
                    secret: roomSecret
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err);
            }
        });
        app.post('/api/session/create', async (req, res) => {
            try {
                const userId = req.body.user as string;
                console.log('create', req.body);
                const user = await this.userManager.getUser(userId);
                const roomId = v4();
                const roomSecret = await this.roomManager.prepareRoom(user!);
                res.send({
                    room: roomId,
                    secret: roomSecret
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err);
            }
        });
        return app;
    }

}
