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
import * as Y from 'yjs';
import { Range } from '@theia/monaco-editor-core';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { ApplicationShell, DecorationStyle } from '@theia/core/lib/browser';
import { EditorDecoration, EditorWidget } from '@theia/editor/lib/browser';
import { ISingleEditOperation } from '@theia/monaco-editor-core/esm/vs/editor/common/core/editOperation';

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

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    protected identity = new Deferred<types.Peer>();
    protected guests = new Map<string, types.Peer>();
    protected isHost = false;
    protected isUpdating = false;
    protected y = new Y.Doc();
    protected colorIndex = 0;
    protected editorDecorations = new Map<EditorWidget, string[]>();
    protected peerDecorations = new Map<string, Map<string, types.EditorRange[]>>();

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
                for (const peer of [init.host, ...init.guests]) {
                    this.guests.set(peer.id, peer);
                    this.createPeerStyleSheet(peer);
                }
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
            this.createPeerStyleSheet(peer);
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
            const uri = this.getPathUri(update.path);
            if (uri) {
                const model = this.getModel(uri);
                if (model) {
                    for (const content of update.content) {
                        const startIndex = model.textEditorModel.getOffsetAt({
                            column: content.range.start.character + 1,
                            lineNumber: content.range.start.line + 1
                        });
                        const endIndex = model.textEditorModel.getOffsetAt({
                            column: content.range.end.character + 1,
                            lineNumber: content.range.end.line + 1
                        });
                        const text = this.y.getText(model.uri);
                        if (startIndex !== endIndex) {
                            text.delete(startIndex, endIndex - startIndex);
                        }
                        if (content.text.length > 0) {
                            this.y.getText(model.uri).insert(startIndex, content.text);
                        }
                    }
                }
            }
        });
        for (const model of this.monacoModelService.models) {
            this.registerModelUpdate(connection, model);
        }
        this.monacoModelService.onDidCreate(newModel => {
            this.registerModelUpdate(connection, newModel);
        });
        this.editorManager.onCreated(widget => {
            const uri = widget.getResourceUri();
            if (uri) {
                const path = this.getPath(uri);
                if (path) {
                    widget.editor.onSelectionChanged(range => {
                        connection.editor.presence({
                            path,
                            selection: [range]
                        });
                    });
                }
            }
        });
        this.getOpenEditors().forEach(widget => {
            const uri = widget.getResourceUri();
            if (uri) {
                const path = this.getPath(uri);
                if (path) {
                    widget.editor.onSelectionChanged(range => {
                        connection.editor.presence({
                            path,
                            selection: [range]
                        });
                    });
                }
            }
        });

        connection.editor.onPresence((peerId, presence) => {
            const peer = this.guests.get(peerId);
            const uri = this.getPathUri(presence.path);
            if (peer && uri) {
                this.setPeerDecorations(peer, presence);
                const decorations: EditorDecoration[] = [];
                for (const peerDecoration of this.getPeerDecorations(presence.path)) {
                    decorations.push(...peerDecoration.selection.map(selection => ({
                        range: selection,
                        options: {
                            className: 'yRemoteSelection yRemoteSelection-' + peerDecoration.peer,
                            beforeContentClassName: 'yRemoteSelectionBefore-' + peerDecoration.peer
                        }
                    })));
                }
                for (const editor of this.getOpenEditors(uri)) {
                    const old = this.editorDecorations.get(editor) ?? [];
                    this.editorDecorations.set(editor, editor.editor.deltaDecorations({
                        newDecorations: decorations,
                        oldDecorations: old
                    }));
                }
            }
        });

        connection.fs.onReadFile(async path => {
            const uri = this.getPathUri(path);
            if (uri) {
                const model = this.getModel(uri);
                if (model) {
                    return model.getText();
                }
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

    protected setPeerDecorations(peer: types.Peer, decoration: types.EditorPresence): void {
        let peerMap = this.peerDecorations.get(peer.id);
        if (!peerMap) {
            peerMap = new Map();
            this.peerDecorations.set(peer.id, peerMap);
        }
        peerMap.set(decoration.path, decoration.selection);
    }

    protected getPeerDecorations(path: string): { peer: string, selection: types.EditorRange[] }[] {
        const items: { peer: string, selection: types.EditorRange[] }[] = [];
        for (const [peer, map] of this.peerDecorations.entries()) {
            const selection = map.get(path);
            if (selection) {
                items.push({
                    peer,
                    selection
                });
            }
        }
        return items;
    }

    protected createPeerStyleSheet(peer: types.Peer): void {
        const sheet = DecorationStyle.createStyleSheet(peer.id);
        const colors = [
            'gold',
            'cyan',
            'orchid',
            'chocolate',
            'chartreuse',
            'navy',
            'beige',
            'indigo',
            'lime',
            'olive',
            'plum',
            'salmon',
            'tomato'
        ];
        const color = colors[this.colorIndex++ % colors.length];
        sheet.insertRule(`
                .yRemoteSelection-${peer.id} {
                    background: ${color};
                }
                `);
        sheet.insertRule(`
                .yRemoteSelectionBefore-${peer.id} {
                    position: absolute;
                    content: " ";
                    background: ${color};
                    border-right: ${color} solid 2px;
                    border-top: ${color} solid 2px;
                    border-bottom: ${color} solid 2px;
                    height: 100%;
                    box-sizing: border-box;
                }`
        );
        sheet.insertRule(`
                .yRemoteSelectionBefore-${peer.id}::after {
                    position: absolute;
                    transform: translateY(-100%);
                    content: "${peer.name}";
                    background: ${color};
                    color: black;
                }`
        );
    }

    protected getOpenEditors(uri?: URI): EditorWidget[] {
        const widgets = this.shell.widgets;
        let editors = widgets.filter(e => e instanceof EditorWidget) as EditorWidget[];
        if (uri) {
            editors = editors.filter(e => e.getResourceUri()?.toString() === uri.toString());
        }
        return editors;
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
                    console.log('Received change without range information');
                }
            }
            connection.editor.update({
                path: path,
                content
            });
        });
        const text = this.y.getText(model.uri);
        text.insert(0, model.getText());
        text.observe(textEvent => {
            this.isUpdating = true;
            let index = 0;
            const operations: ISingleEditOperation[] = [];
            textEvent.delta.forEach(delta => {
                if (delta.retain !== undefined) {
                    index += delta.retain;
                } else if (delta.insert !== undefined) {
                    const pos = model.textEditorModel.getPositionAt(index);
                    const range = new Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
                    const insert = delta.insert as string;
                    operations.push({ range, text: insert });
                    index += insert.length;
                } else if (delta.delete !== undefined) {
                    const pos = model.textEditorModel.getPositionAt(index);
                    const endPos = model.textEditorModel.getPositionAt(index + delta.delete);
                    const range = new Range(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column);
                    operations.push({ range, text: '' });
                }
            });
            // eslint-disable-next-line no-null/no-null
            model.textEditorModel.pushEditOperations(null, operations, () => null);
            this.isUpdating = false;
        });
    }

    protected getModel(uri: URI): MonacoEditorModel | undefined {
        return this.monacoModelService.models.find(e => e.uri === uri.toString());
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
