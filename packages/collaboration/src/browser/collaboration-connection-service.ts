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
import { io } from 'socket.io-client';
import { CollaborationConnection, Connection } from '../common/collaboration-connection';

function getUrl(path: string): string {
    return `http://localhost:8100${path}`;
}

@injectable()
export class CollaborationConnectionService {

    protected token = '';
    protected user = '';
    protected roomId = '';
    protected roomSecret = '';

    connection: CollaborationConnection;

    async login(): Promise<void> {
        const response = await fetch(getUrl('/api/user/login'), {
            method: 'POST',
            body: JSON.stringify({ name: 'Anon' + Date.now() }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const body = await response.json();
        this.token = body.token;
        this.user = body.user;
    }

    async createRoom(): Promise<void> {
        const response = await fetch(getUrl('/api/session/create'), {
            method: 'POST',
            body: JSON.stringify({ user: this.user }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const body = await response.json();
        this.roomId = body.room;
        this.roomSecret = body.secret;
        console.log('Created room: ' + body.room);
    }

    async joinRoom(id: string): Promise<void> {
        const response = await fetch(getUrl('/api/session/join'), {
            method: 'POST',
            body: JSON.stringify({ user: this.user, room: id }),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const body = await response.json();
        this.roomId = body.room;
        this.roomSecret = body.secret;
    }

    connect(): void {
        const socket = io(getUrl(''), {
            extraHeaders: {
                'x-room': this.roomId,
                'x-secret': this.roomSecret,
                'authorization': this.token
            }
        });
        this.connection = new Connection(
            data => socket.emit('message', data),
            cb => socket.on('message', cb)
        );
        socket.connect();
    }

}
