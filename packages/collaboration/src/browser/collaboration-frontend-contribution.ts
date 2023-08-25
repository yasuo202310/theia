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

import '../../src/browser/style/index.css';

import { Command, CommandContribution, CommandRegistry, MessageService, nls, QuickInputService, QuickPickItem } from '@theia/core';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { CollaborationAuthHandler } from '../common/collaboration-connection';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CollaborationInstance, CollaborationInstanceFactory } from './collaboration-instance';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';
import { StatusBar, StatusBarAlignment, StatusBarEntry } from '@theia/core/lib/browser/status-bar';
import { codiconArray } from '@theia/core/lib/browser/widgets/widget';

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

export const COLLABORATION_STATUS_BAR_ID = 'statusBar.collaboration';

@injectable()
export class CollaborationFrontendContribution implements CommandContribution {

    protected readonly authHandlerDeferred = new Deferred<CollaborationAuthHandler>();

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(QuickInputService) @optional()
    protected readonly quickInputService?: QuickInputService;

    @inject(EnvVariablesServer)
    protected readonly envVariables: EnvVariablesServer;

    @inject(CollaborationWorkspaceService)
    protected readonly workspaceService: CollaborationWorkspaceService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(CollaborationInstanceFactory)
    protected readonly collaborationInstanceFactory: CollaborationInstanceFactory;

    protected currentInstance?: CollaborationInstance;

    @postConstruct()
    protected init(): void {
        this.setStatusBarEntryDefault();
        this.getCollaborationServerUrl().then(serverUrl => {
            const authHandler = new CollaborationAuthHandler(
                serverUrl,
                localStorage.getItem('THEIA_COLLAB_AUTH_TOKEN') ?? undefined,
                url => this.windowService.openNewWindow(url)
            );
            this.authHandlerDeferred.resolve(authHandler);
        }, err => this.authHandlerDeferred.reject(err));
    }

    protected async onStatusDefaultClick(): Promise<void> {
        const items: QuickPickItem[] = [];
        if (this.workspaceService.opened) {
            items.push({
                label: nls.localize('theia/collaboration/createRoom', 'Create new collaboration session'),
                iconClasses: codiconArray('add'),
                execute: () => this.commands.executeCommand(CollaborationCommands.CREATE_ROOM.id)
            });
        }
        items.push({
            label: nls.localize('theia/collaboration/joinRoom', 'Join collaboration session'),
            iconClasses: codiconArray('vm-connect'),
            execute: () => this.commands.executeCommand(CollaborationCommands.JOIN_ROOM.id)
        });
        await this.quickInputService?.showQuickPick(items, {
            placeholder: nls.localize('theia/collaboration/selectCollaboration', 'Select collaboration option')
        });
    }

    protected async onStatusSharedClick(code: string): Promise<void> {
        const items: QuickPickItem[] = [{
            label: nls.localize('theia/collaboration/invite', 'Invite Others'),
            detail: nls.localize('theia/collaboration/inviteDetail', 'Copy the invitation code so you can send it to other participants.'),
            iconClasses: codiconArray('clippy'),
            execute: () => this.displayCopyNotification(code)
        }];
        if (this.currentInstance) {
            if (this.currentInstance.readonly) {
                items.push({
                    label: nls.localize('theia/collaboration/makeWritable', 'Make writeable'),
                    detail: nls.localize('theia/collaboration/makeWritableDetail', 'Allow all participants to write to your workspace.'),
                    iconClasses: codiconArray('unlock'),
                    execute: () => {
                        if (this.currentInstance) {
                            this.currentInstance.readonly = false;
                        }
                    }
                });
            } else {
                items.push({
                    label: nls.localize('theia/collaboration/makeReadonly', 'Make read-only'),
                    detail: nls.localize('theia/collaboration/makeReadonlyDetail', 'Prevent all participants from writing to your workspace.'),
                    iconClasses: codiconArray('lock'),
                    execute: () => {
                        if (this.currentInstance) {
                            this.currentInstance.readonly = true;
                        }
                    }
                });
            }
        }
        items.push({
            label: nls.localize('theia/collaboration/stop', 'Stop Collaboration Session'),
            detail: nls.localize('theia/collaboration/stopDetail', 'Stop collaboration session, stop sharing all content, and remove all participant access.'),
            iconClasses: codiconArray('circle-slash'),
            execute: () => this.currentInstance?.dispose()
        });
        await this.quickInputService?.showQuickPick(items, {
            placeholder: nls.localize('theia/collaboration/whatToDo', 'What would you like to do with other collaborators?')
        });
    }

    protected async onStatusConnectedClick(code: string): Promise<void> {
        const items: QuickPickItem[] = [{
            label: nls.localize('theia/collaboration/invite', 'Invite Others'),
            detail: nls.localize('theia/collaboration/inviteDetail', 'Copy the invitation code so you can send it to other participants.'),
            iconClasses: codiconArray('clippy'),
            execute: () => this.displayCopyNotification(code)
        }];
        items.push({
            label: nls.localize('theia/collaboration/stop', 'Disconnect Collaboration Session'),
            detail: nls.localize('theia/collaboration/stopDetail', 'Disconnect from the current collaboration session and close the workspace.'),
            iconClasses: codiconArray('circle-slash'),
            execute: () => this.currentInstance?.dispose()
        });
        await this.quickInputService?.showQuickPick(items, {
            placeholder: nls.localize('theia/collaboration/whatToDo', 'What would you like to do with other collaborators?')
        });
    }

    protected async setStatusBarEntryDefault(): Promise<void> {
        await this.setStatusBarEntry({
            text: '$(codicon-live-share) ' + nls.localizeByDefault('Share'),
            tooltip: nls.localize('theia/collaboration/startSession', 'Start or join collaboration session'),
            onclick: () => this.onStatusDefaultClick()
        });
    }

    protected async setStatusBarEntryShared(code: string): Promise<void> {
        await this.setStatusBarEntry({
            text: '$(codicon-broadcast) ' + nls.localizeByDefault('Shared'),
            tooltip: nls.localize('theia/collaboration/sharedSession', 'Shared a collaboration session'),
            onclick: () => this.onStatusSharedClick(code)
        });
    }

    protected async setStatusBarEntryConnected(code: string): Promise<void> {
        await this.setStatusBarEntry({
            text: '$(codicon-broadcast) ' + nls.localize('theia/collaboration/connected', 'Connected'),
            tooltip: nls.localize('theia/collaboration/connectedSession', 'Connected to a collaboration session'),
            onclick: () => this.onStatusConnectedClick(code)
        });
    }

    protected async setStatusBarEntry(entry: Omit<StatusBarEntry, 'alignment'>): Promise<void> {
        await this.statusBar.setElement(COLLABORATION_STATUS_BAR_ID, {
            ...entry,
            alignment: StatusBarAlignment.LEFT,
            priority: 5
        });
    }

    protected async getCollaborationServerUrl(): Promise<string> {
        const variables = await this.envVariables.getVariables();
        const serverUrlVariable = variables.find(variable => variable.name.toLowerCase() === 'COLLABORATION_SERVER_URL');
        return serverUrlVariable?.value || 'http://localhost:8100';
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CollaborationCommands.CREATE_ROOM, {
            isVisible: () => this.workspaceService.opened,
            isEnabled: () => this.workspaceService.opened,
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
                this.currentInstance.onDidClose(() => {
                    this.setStatusBarEntryDefault();
                });
                const roomCode = roomToken.room;
                this.setStatusBarEntryShared(roomCode);
                this.displayCopyNotification(roomCode, true);
            }
        });
        commands.registerCommand(CollaborationCommands.JOIN_ROOM, {
            execute: async () => {
                const authHandler = await this.authHandlerDeferred.promise;
                const id = await this.quickInputService?.input({
                    placeHolder: nls.localize('theia/collaboration/enterCode', 'Enter collaboration session code')
                });
                if (!id) {
                    return;
                }
                const roomToken = await authHandler.joinRoom(id);
                if (roomToken.login) {
                    localStorage.setItem('THEIA_COLLAB_AUTH_TOKEN', roomToken.login);
                }
                this.currentInstance?.dispose();
                const connection = authHandler.connect();
                this.currentInstance = this.collaborationInstanceFactory({
                    role: 'guest',
                    connection
                });
                this.currentInstance.onDidClose(() => {
                    this.setStatusBarEntryDefault();
                });
                await this.currentInstance.initialize();
            }
        });
    }

    protected async displayCopyNotification(code: string, firstTime = false): Promise<void> {
        navigator.clipboard.writeText(code);
        const notification = nls.localize('theia/collaboration/copiedInvitation', 'Invitation code copied to clipboard.');
        if (firstTime) {
            const makeReadonly = nls.localize('theia/collaboration/makeReadonly', 'Make read-only');
            const copyAgain = nls.localize('theia/collaboration/copyAgain', 'Copy Again');
            const copyResult = await this.messageService.info(
                notification,
                makeReadonly,
                copyAgain
            );
            if (copyResult === makeReadonly && this.currentInstance) {
                this.currentInstance.readonly = true;
            }
            if (copyResult === copyAgain) {
                navigator.clipboard.writeText(code);
            }
        } else {
            await this.messageService.info(
                notification
            );
        }
    }
}
