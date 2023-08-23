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
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { CollaborationAuthHandler } from '../common/collaboration-connection';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CollaborationInstance, CollaborationInstanceFactory } from './collaboration-instance';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';

import '../../src/browser/style/index.css';

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

    protected readonly authHandlerDeferred = new Deferred<CollaborationAuthHandler>();

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    @inject(CollaborationWorkspaceService)
    protected readonly workspaceService: CollaborationWorkspaceService;

    @inject(CollaborationInstanceFactory)
    protected readonly collaborationInstanceFactory: CollaborationInstanceFactory;

    protected currentInstance?: CollaborationInstance;

    @postConstruct()
    protected init(): void {
        this.getCollaborationServerUrl().then(serverUrl => {
            const authHandler = new CollaborationAuthHandler(
                serverUrl,
                localStorage.getItem('THEIA_COLLAB_AUTH_TOKEN') ?? undefined,
                url => this.windowService.openNewWindow(url)
            );
            this.authHandlerDeferred.resolve(authHandler);
        }, err => this.authHandlerDeferred.reject(err));
    }

    protected async getCollaborationServerUrl(): Promise<string> {
        const variables = await this.envVariables.getVariables();
        const serverUrlVariable = variables.find(variable => variable.name.toLowerCase() === 'COLLABORATION_SERVER_URL');
        return serverUrlVariable?.value || 'http://localhost:8100';
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CollaborationCommands.CREATE_ROOM, {
            execute: async () => {
                const authHandler = await this.authHandlerDeferred.promise;
                const roomToken = await authHandler.createRoom();
                if (roomToken.login) {
                    localStorage.setItem('THEIA_COLLAB_AUTH_TOKEN', roomToken.login);
                }
                this.currentInstance?.dispose();
                const connection = authHandler.connect();
                this.currentInstance = this.collaborationInstanceFactory({
                    role: 'host',
                    connection
                });
                navigator.clipboard.writeText(roomToken.room);
            }
        });
        commands.registerCommand(CollaborationCommands.JOIN_ROOM, {
            execute: async () => {
                const authHandler = await this.authHandlerDeferred.promise;
                const id = await this.quickInputService.input();
                const roomToken = await authHandler.joinRoom(id!);
                if (roomToken.login) {
                    localStorage.setItem('THEIA_COLLAB_AUTH_TOKEN', roomToken.login);
                }
                this.currentInstance?.dispose();
                const connection = authHandler.connect();
                this.currentInstance = this.collaborationInstanceFactory({
                    role: 'guest',
                    connection
                });
                await this.currentInstance.initialize();
            }
        });
    }
}
