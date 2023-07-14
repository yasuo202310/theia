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

import { Socket } from 'socket.io';
import { BroadcastMessage, NotificationMessage, RequestMessage } from '../common/protocol';

export interface Room {
    id: string
    host: Peer
    guests: Peer[]
    permissions: Permissions
    sendBroadcast(origin: Peer, message: BroadcastMessage): void;
}

export interface PeerInfo {
    name: string
    email?: string
}

export interface Peer {
    id: string
    name: string
    email?: string
    socket: Socket
    sendNotification(message: NotificationMessage): void;
    sendRequest(message: RequestMessage): Promise<unknown>;
    sendBroadcast(origin: Peer, message: BroadcastMessage): void;
}

export type Permissions = Record<string, string>;
