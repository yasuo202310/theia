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

import * as types from './collaboration-types';
import { BroadcastType, RequestType, NotificationType } from './protocol';

export namespace Messages {

    export namespace Peer {
        export const Join = new RequestType<[types.User], boolean>('peer/join');
        export const Info = new NotificationType<[types.Peer]>('peer/info');
        export const Init = new RequestType<[types.InitRequest], types.InitResponse>('peer/init');
    }

    export namespace Room {
        export const Joined = new BroadcastType<[types.Peer]>('room/joined');
        export const Left = new BroadcastType<[types.Peer]>('room/left');
        export const PermissionsUpdated = new BroadcastType<[types.Permissions]>('room/permissionsUpdated');
        export const Closed = new BroadcastType('room/closed');

    }

    export namespace Editor {
        export const Update = new BroadcastType<[types.EditorUpdate]>('editor/update');
        export const Presence = new BroadcastType<[]>('editor/presence');
        export const Grammar = new RequestType<[string], unknown>('editor/grammar');
    }

    export namespace Workspace {
        // eslint-disable-next-line @typescript-eslint/no-shadow
        export const Entry = new RequestType<[string], types.WorkspaceEntry>('workspace/entry');
        export const File = new RequestType<[string], string>('workspace/file');
    }

}

