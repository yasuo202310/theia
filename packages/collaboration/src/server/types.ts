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

import { Channel } from './channel';
import * as protocol from '../common/collaboration-types';

export interface Room {
    id: string;
    host: Peer;
    guests: Peer[];
    readonly peers: readonly Peer[];
}

export interface User {
    id: string;
    name: string;
    email?: string;
}

export const PeerInfo = Symbol('PeerInfo');

export interface PeerInfo {
    user: User;
    channel: Channel;
}

export interface Peer {
    id: string;
    user: User;
    channel: Channel;
    room: Room;
    toProtocol(): protocol.Peer
}

export type Permissions = Record<string, string>;
