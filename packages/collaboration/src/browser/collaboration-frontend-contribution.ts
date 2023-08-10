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

import { Command, CommandContribution, CommandRegistry, MessageService, QuickInputService, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CollaborationAuthHandler, CollaborationConnection } from '../common/collaboration-connection';
import { Messages } from '../common/collaboration-messages';
import { InitResponse, Peer, WorkspaceChildEntry, WorkspaceEntry, WorkspaceEntryType } from '../common/collaboration-types';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';
import { CollaborationFileService } from './collaboration-file-service';

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

    protected readonly collaborationService = new CollaborationAuthHandler(
        'http://localhost:8100',
        localStorage.getItem('THEIA_COLLAB_AUTH_TOKEN') ?? undefined,
        url => this.windowService.openNewWindow(url)
    );

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(CollaborationWorkspaceService)
    protected readonly workspaceService: CollaborationWorkspaceService;

    @inject(CollaborationFileService)
    protected readonly fileService: CollaborationFileService;

    protected identity = new Deferred<Peer>();
    protected guests = new Map<string, Peer>();

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(CollaborationCommands.CREATE_ROOM, {
            execute: async () => {
                const roomToken = await this.collaborationService.createRoom();
                if (roomToken.login) {
                    localStorage.setItem('THEIA_COLLAB_AUTH_TOKEN', roomToken.login);
                }
                const connection = this.collaborationService.connect();
                this.registerConnection(connection);
                navigator.clipboard.writeText(roomToken.room);
            }
        });
        commands.registerCommand(CollaborationCommands.JOIN_ROOM, {
            execute: async () => {
                const id = await this.quickInputService.input();
                const roomToken = await this.collaborationService.joinRoom(id!);
                if (roomToken.login) {
                    localStorage.setItem('THEIA_COLLAB_AUTH_TOKEN', roomToken.login);
                }
                const connection = this.collaborationService.connect();
                this.registerConnection(connection);
                const workspace = await connection.peer.init({});
                console.log('Workspace: ', workspace);
                this.workspaceService.setHostWorkspace(workspace.workspace, connection);
                this.fileService.setConnection(connection);
            }
        });
    }

    protected registerConnection(connection: CollaborationConnection): void {
        connection.peer.onJoinRequest(async user => {
            const result = await this.messageService.info(
                `User '${user.name + (user.email ? ` (${user.email})` : '')}' wants to join the collaboration room`,
                'Allow',
                'Deny'
            );
            return result === 'Allow';
        });
        connection.room.onJoin((_, peer) => {
            console.log('Peer joined the room: ', peer);
            this.guests.set(peer.id, peer);
        });
        connection.room.onLeave((_, peer) => {
            console.log('Peer left the room:', peer);
            this.guests.delete(peer.id);
        });
        connection.room.onClose(() => {
            console.log('Room has closed!');
        });
        connection.onBroadcast(Messages.Room.PermissionsUpdated, (_, permissions) => {
            console.log('Permissions updated: ' + permissions);
        });
        connection.peer.onInfo(peer => {
            this.identity.resolve(peer);
        });
        connection.peer.onInit(async () => {
            const roots = await this.workspaceService.roots;
            const resolvedRoots = await Promise.all(roots.map(root => this.resolveStat(root.resource)));
            const response: InitResponse = {
                host: await this.identity.promise,
                guests: Array.from(this.guests.values()),
                capabilities: {},
                permissions: {},
                workspace: resolvedRoots
            };
            return response;
        });
        connection.workspace.onEntry(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                return this.resolveStat(uri);
            } else {
                throw new Error('Could not resolve path');
            }
        });
        connection.workspace.onFile(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                const content = await this.fileService.readFile(uri);
                return content.value.toString();
            } else {
                throw new Error();
            }
        });
    }

    protected getPathUri(path: string): URI | undefined {
        const parts = path.split('/');
        const root = parts[0];
        const rest = parts.slice(1);
        const stat = this.workspaceService.tryGetRoots().find(e => e.name === root);
        if (stat) {
            const uriPath = stat.resource.path.join(...rest);
            const uri = stat.resource.withPath(uriPath);
            return uri;
        } else {
            return undefined;
        }
    }

    protected async resolveStat(uri: URI): Promise<WorkspaceEntry> {
        const fileStat = await this.fileService.resolve(uri);
        const children: WorkspaceChildEntry[] = fileStat.children?.map(e => ({
            name: e.name,
            type: e.isFile ? WorkspaceEntryType.FILE : WorkspaceEntryType.DIRECTORY
        })) ?? [];
        return {
            name: fileStat.name,
            ctime: fileStat.ctime ?? 0,
            mtime: fileStat.mtime ?? 0,
            size: fileStat.size ?? 0,
            type: fileStat.isFile ? WorkspaceEntryType.FILE : WorkspaceEntryType.DIRECTORY,
            children
        };
    }

//     protected async resolveStat(stat: FileStat): Promise<WorkspaceEntry> {
//
//     }

    // protected async workspaceEntryFromStat(stat: FileStat): Promise<WorkspaceEntry | undefined> {
    //     const fileStat = await this.fileService.resolve(stat.resource);
    //     if (stat.isDirectory && stat.children) {
    //         const entry: WorkspaceEntry = {};
    //         for (const child of stat.children) {
    //             entry[child.name] = this.workspaceEntryFromStat(child);
    //         }
    //         return entry;
    //     }
    //     return undefined;
    // }
}
