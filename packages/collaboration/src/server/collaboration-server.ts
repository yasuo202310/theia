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
import * as path from 'path';
import { Server } from 'socket.io';
import * as express from '@theia/core/shared/express';
import { SocketIoChannel } from './channel';
import { PeerFactory } from './peer';
import { RoomClaim, RoomManager } from './room-manager';
import { UserManager } from './user-manager';
import { CredentialsManager } from './credentials-manager';
import { User } from './types';
import { ErrorMessage } from '../common/protocol';

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

    protected simpleLogin = true;

    startServer(args: Record<string, unknown>): void {
        const httpServer = http.createServer(this.setupApiRoute());
        const io = new Server(httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        io.on('connection', async socket => {
            const headers = socket.request.headers;
            const jwt = headers['x-jwt'] as string;
            if (!jwt) {
                socket.send(ErrorMessage.create('No JWT auth token set'));
                socket.disconnect(true);
                return;
            }
            try {
                const roomClaim = await this.credentials.verifyJwt<RoomClaim>(jwt);
                const channel = new SocketIoChannel(socket);
                const peer = this.peerFactory({
                    user: roomClaim.user,
                    channel
                });
                await this.roomManager.join(peer, roomClaim.room, roomClaim.host ?? false);
            } catch (err) {
                socket.send(ErrorMessage.create('Failed to join room'));
                socket.disconnect(true);
                console.log(err);
            }
        });
        httpServer.listen(Number(args.port), String(args.hostname));
    }

    protected async getUserFromAuth(req: express.Request): Promise<User | undefined> {
        const auth = req.headers['x-jwt'] as string;
        try {
            const user = await this.credentials.getUser(auth);
            return user;
        } catch {
            return undefined;
        }
    }

    protected setupApiRoute(): express.Application {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            next();
        });
        app.use(async (req, res, next) => {
            if (req.method === 'POST' && req.url.startsWith('/api/') && !req.url.startsWith('/api/login/')) {
                const user = await this.getUserFromAuth(req);
                if (!user) {
                    res.status(403);
                    res.send('Forbidden resource');
                } else {
                    next();
                }
            } else {
                next();
            }
        });
        app.use(express.static(path.resolve(__dirname, '../../src/server/static')));
        app.post('/api/login/url', async (req, res) => {
            try {
                const token = this.credentials.secureId();
                const index = `/login.html?token=${token}`;
                res.send({
                    url: index,
                    token
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err.message);
            }
        });
        app.post('/api/login/validate', async (req, res) => {
            const user = await this.getUserFromAuth(req);
            if (user) {
                res.send('true');
            } else {
                res.send('false');
            }
        });
        if (this.simpleLogin) {
            app.post('/api/login/simple', async (req, res) => {
                try {
                    const token = req.body.token as string;
                    const user = req.body.user as string;
                    const email = req.body.email as string | undefined;
                    await this.credentials.confirmUser(token, {
                        name: user,
                        email
                    });
                    res.send('Ok');
                } catch (err) {
                    console.error(err);
                    res.status(400);
                    res.send(err.message);
                }
            });
        }
        app.post('/api/login/confirm/:token', async (req, res) => {
            try {
                const token = req.params.token as string;
                const jwt = await this.credentials.confirmAuth(token);
                const user = await this.credentials.getUser(jwt);
                res.send({
                    user,
                    token: jwt
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err.message);
            }
        });
        app.post('/api/session/join/:room', async (req, res) => {
            try {
                const roomId = req.params.room as string;
                const user = await this.getUserFromAuth(req);
                const room = this.roomManager.getRoomById(roomId);
                if (!room) {
                    throw new Error(`Room with requested id ${roomId} does not exist`);
                }
                const jwt = await this.roomManager.requestJoin(room, user!);
                res.send({
                    token: jwt
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err.message);
            }
        });
        app.post('/api/session/create', async (req, res) => {
            try {
                const user = await this.getUserFromAuth(req);
                const room = await this.roomManager.prepareRoom(user!);
                res.send({
                    room: room.id,
                    token: room.jwt
                });
            } catch (err) {
                console.error(err);
                res.status(400);
                res.send(err.message);
            }
        });
        return app;
    }

}
