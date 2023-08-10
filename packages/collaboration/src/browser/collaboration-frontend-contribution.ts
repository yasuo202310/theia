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
import * as types from '../common/collaboration-types';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { CollaborationFileSystemProvider } from './collaboration-file-system-provider';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';

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

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(MonacoTextModelService)
    protected readonly monacoModelService: MonacoTextModelService;

    protected identity = new Deferred<types.Peer>();
    protected guests = new Map<string, types.Peer>();
    protected isHost = false;
    protected isUpdating = false;

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
                this.isHost = true;
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
                const init = await connection.peer.init({});
                console.log('Init: ', init);
                this.fileService.registerProvider('collaboration', new CollaborationFileSystemProvider(connection));
                this.workspaceService.setHostWorkspace(init.workspace, connection);
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
            const response: types.InitResponse = {
                host: await this.identity.promise,
                guests: Array.from(this.guests.values()),
                capabilities: {},
                permissions: {},
                workspace: {
                    name: this.workspaceService.workspace?.name ?? 'Collaboration',
                    folders: roots.map(e => e.name)
                }
            };
            return response;
        });
        connection.editor.onUpdate((_, update) => {
            const uri = this.getPathUri(update.uri);
            if (uri) {
                const model = this.monacoModelService.models.find(e => e.uri === uri.toString());
                if (model) {
                    this.isUpdating = true;
                    model.textEditorModel.applyEdits(update.content.map(content => ({
                        range: {
                            startLineNumber: content.range!.start.line + 1,
                            startColumn: content.range!.start.character + 1,
                            endLineNumber: content.range!.end.line + 1,
                            endColumn: content.range!.end.character + 1
                        },
                        text: content.text
                    })));
                    this.isUpdating = false;
                }
            }
        });
        for (const model of this.monacoModelService.models) {
            this.registerModelUpdate(connection, model);
        }
        this.monacoModelService.onDidCreate(newModel => {
            this.registerModelUpdate(connection, newModel);
        });
        connection.fs.onReadFile(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                const content = await this.fileService.readFile(uri);
                return content.value.toString();
            } else {
                throw new Error('Could not read file: ' + path);
            }
        });
        connection.fs.onReaddir(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                const resolved = await this.fileService.resolve(uri);
                if (resolved.children) {
                    const dir: Record<string, types.FileType> = {};
                    for (const child of resolved.children) {
                        dir[child.name] = child.isDirectory ? types.FileType.Directory : types.FileType.File;
                    }
                    return dir;
                } else {
                    return {};
                }
            } else {
                throw new Error('Could not read directory: ' + path);
            }
        });
        connection.fs.onStat(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                const content = await this.fileService.resolve(uri, {
                    resolveMetadata: true
                });
                return {
                    type: content.isDirectory ? types.FileType.Directory : types.FileType.File,
                    ctime: content.ctime,
                    mtime: content.mtime,
                    size: content.size,
                    permissions: content.isReadonly ? types.FilePermission.Readonly : undefined
                };
            } else {
                throw new Error('Could not stat entry: ' + path);
            }
        });
    }

    protected registerModelUpdate(connection: CollaborationConnection, model: MonacoEditorModel): void {
        model.onDidChangeContent(e => {
            if (this.isUpdating) {
                return;
            }
            const path = this.getPath(new URI(model.uri));
            if (!path) {
                return;
            }
            const content: types.EditorContentUpdate[] = [];
            for (const change of e.contentChanges) {
                if ('range' in change) {
                    content.push({
                        range: change.range,
                        text: change.text
                    });
                } else {
                    content.push({
                        text: change.text
                    });
                }
            }
            connection.editor.update({
                uri: path,
                content
            });
        });
    }

    protected getPath(uri: URI): string | undefined {
        const path = uri.path.toString();
        const roots = this.workspaceService.tryGetRoots();
        for (const root of roots) {
            const rootUri = root.resource.path.toString() + '/';
            if (path.startsWith(rootUri)) {
                return root.name + '/' + path.substring(rootUri.length);
            }
        }
        return undefined;
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
}
