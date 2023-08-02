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

import { Disposable } from '@theia/core';
import { Socket } from 'socket.io';
import { Message } from '../common/protocol';

export interface Channel {
    onMessage(cb: (message: Message) => void): Disposable;
    sendMessage(message: Message): void;
    close(): void;
}

export class SocketIoChannel implements Channel {

    private _socket: Socket;

    constructor(socket: Socket) {
        this._socket = socket;
    }

    onMessage(cb: (message: Message) => void): Disposable {
        this._socket.on('message', cb);
        return Disposable.create(() => {
            this._socket.off('message', cb);
        });
    }
    sendMessage(message: Message): void {
        this._socket.send(message);
    }
    close(): void {
        this._socket.disconnect();
    }
}
