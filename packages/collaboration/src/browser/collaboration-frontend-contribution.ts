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

import { Command, CommandContribution, CommandRegistry, QuickInputService } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CollaborationConnection } from '../common/collaboration-connection';
import { RoomJoin } from '../common/collaboration-messages';
import { CollaborationConnectionService } from './collaboration-connection-service';

export const COLLABORATION_CATEGORY = 'Collaboration';

export namespace CollaborationCommands {
    export const LOGIN: Command = {
        id: 'collaboration.login',
        label: 'Login',
        category: COLLABORATION_CATEGORY
    };
    export const CREATE_ROOM: Command = {
        id: 'collaboration.create-room',
        label: 'Create Room',
        category: COLLABORATION_CATEGORY
    };
    export const JOIN_ROOM: Command = {
        id: 'collaboration.join-room',
        label: 'Join Room',
        category: COLLABORATION_CATEGORY
    };
}

@injectable()
export class CollaborationFrontendContribution implements CommandContribution {

    @inject(CollaborationConnectionService)
    protected readonly collaborationService: CollaborationConnectionService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CollaborationCommands.CREATE_ROOM, {
            execute: async () => {
                await this.collaborationService.login();
                await this.collaborationService.createRoom();
                this.collaborationService.connect();
                this.registerConnection(this.collaborationService.connection);
            }
        });
        commands.registerCommand(CollaborationCommands.JOIN_ROOM, {
            execute: async () => {
                await this.collaborationService.login();
                const id = await this.quickInputService.input();
                await this.collaborationService.joinRoom(id!);
                this.collaborationService.connect();
                this.registerConnection(this.collaborationService.connection);
            }
        });
    }

    protected registerConnection(connection: CollaborationConnection): void {
        connection.onRequest(RoomJoin, async peer => {
            console.log('Peer requested join: ', peer);
            return true;
        });
    }
}
