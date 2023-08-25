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

import { Disposable, DisposableCollection, Emitter, Event, MessageService, URI } from '@theia/core';
import { Container, inject, injectable, interfaces, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { CollaborationConnection, PROTOCOL_VERSION } from '../common/collaboration-connection';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';
import { Range as MonacoRange } from '@theia/monaco-editor-core';
import { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { EditorDecoration, EditorWidget } from '@theia/editor/lib/browser';
import { ISingleEditOperation } from '@theia/monaco-editor-core/esm/vs/editor/common/core/editOperation';
import { DecorationStyle } from '@theia/core/lib/browser';
import { CollaborationFileSystemProvider } from './collaboration-file-system-provider';
import { Range } from '@theia/core/shared/vscode-languageserver-protocol';
import { CollaborationColorService } from './collaboration-color-service';

import * as types from '../common/collaboration-types';
import * as Y from 'yjs';

export const CollaborationInstanceFactory = Symbol('CollaborationInstanceFactory');
export type CollaborationInstanceFactory = (connection: CollaborationInstanceOptions) => CollaborationInstance;

export const CollaborationInstanceOptions = Symbol('CollaborationInstanceOptions');
export interface CollaborationInstanceOptions {
    role: 'host' | 'guest';
    connection: CollaborationConnection;
}

export function createCollaborationInstanceContainer(parent: interfaces.Container, options: CollaborationInstanceOptions): Container {
    const child = new Container();
    child.parent = parent;
    child.bind(CollaborationInstance).toSelf().inTransientScope();
    child.bind(CollaborationInstanceOptions).toConstantValue(options);
    return child;
}

export class CollaborationPeer implements types.Peer, Disposable {
    id: string;
    name: string;
    email?: string | undefined;

    decorations = new Map<string, types.EditorSelection[]>();

    constructor(peer: types.Peer, protected disposable: Disposable) {
        this.id = peer.id;
        this.name = peer.name;
        this.email = peer.email;
    }

    dispose(): void {
        this.disposable.dispose();
    }
}

export const COLLABORATION_SELECTION = 'theia-collaboration-selection';
export const COLLABORATION_SELECTION_MARKER = 'theia-collaboration-selection-marker';
export const COLLABORATION_SELECTION_INVERTED = 'theia-collaboration-selection-inverted';

@injectable()
export class CollaborationInstance implements Disposable {

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

    @inject(CollaborationInstanceOptions)
    protected readonly options: CollaborationInstanceOptions;

    @inject(CollaborationColorService)
    protected readonly collaborationColorService: CollaborationColorService;

    protected identity = new Deferred<types.Peer>();
    protected peers = new Map<string, CollaborationPeer>();
    protected isUpdating = false;
    protected yjs = new Y.Doc();
    protected colorIndex = 0;
    protected editorDecorations = new Map<EditorWidget, string[]>();
    protected fileSystem?: CollaborationFileSystemProvider;
    protected permissions: types.Permissions = {
        readonly: false
    };

    protected onDidCloseEmitter = new Emitter<void>();

    get onDidClose(): Event<void> {
        return this.onDidCloseEmitter.event;
    }

    protected toDispose = new DisposableCollection();
    protected _readonly = false;

    get readonly(): boolean {
        return this._readonly;
    }

    set readonly(value: boolean) {
        if (value !== this.readonly) {
            if (this.options.role === 'guest' && this.fileSystem) {
                this.fileSystem.readonly = value;
            } else if (this.options.role === 'host') {
                this.options.connection.room.updatePermissions({
                    ...(this.permissions ?? {}),
                    readonly: value
                });
            }
            if (this.permissions) {
                this.permissions.readonly = value;
            }
            this._readonly = value;
        }
    }

    @postConstruct()
    protected init(): void {
        const connection = this.options.connection;
        this.toDispose.push(Disposable.create(() => this.yjs.destroy()));
        this.toDispose.push(connection);
        this.toDispose.push(this.onDidCloseEmitter);
        connection.peer.onJoinRequest(async user => {
            const result = await this.messageService.info(
                `User '${user.name + (user.email ? ` (${user.email})` : '')}' wants to join the collaboration room`,
                'Allow',
                'Deny'
            );
            return result === 'Allow';
        });
        connection.room.onJoin((_, peer) => {
            this.addPeer(peer);
        });
        connection.room.onLeave((_, peer) => {
            this.peers.get(peer.id)?.dispose();
        });
        connection.room.onClose(() => {
            this.dispose();
        });
        connection.room.onPermissions((_, permissions) => {
            if (this.fileSystem) {
                this.fileSystem.readonly = permissions.readonly;
            }
        });
        connection.peer.onInfo(peer => {
            this.identity.resolve(peer);
        });
        connection.peer.onInit(async () => {
            const roots = await this.workspaceService.roots;
            const response: types.InitResponse = {
                protocol: PROTOCOL_VERSION,
                host: await this.identity.promise,
                guests: Array.from(this.peers.values()),
                capabilities: {},
                permissions: this.permissions,
                workspace: {
                    name: this.workspaceService.workspace?.name ?? 'Collaboration',
                    folders: roots.map(e => e.name)
                }
            };
            return response;
        });
        connection.editor.onUpdate((_, update) => {
            const uri = this.getResourceUri(update.path);
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
                        const text = this.yjs.getText(model.uri);
                        if (startIndex !== endIndex) {
                            text.delete(startIndex, endIndex - startIndex);
                        }
                        if (content.text.length > 0) {
                            text.insert(startIndex, content.text);
                        }
                    }
                }
            }
        });
        for (const model of this.monacoModelService.models) {
            this.registerModelUpdate(model);
        }
        this.monacoModelService.onDidCreate(newModel => {
            this.registerModelUpdate(newModel);
        });
        this.editorManager.onCreated(widget => {
            this.registerPresenceUpdate(widget);
        });
        this.getOpenEditors().forEach(widget => {
            this.registerPresenceUpdate(widget);
        });

        connection.editor.onPresence((peerId, presence) => {
            const peer = this.peers.get(peerId);
            const uri = this.getResourceUri(presence.path);
            if (peer && uri) {
                peer.decorations.set(presence.path, presence.selection);
                const decorations: EditorDecoration[] = [];
                for (const peerDecoration of this.getPeerDecorations(presence.path)) {
                    decorations.push(...peerDecoration.selection.map(selection => {
                        const forward = selection.direction === types.EditorSelectionDirection.Forward;
                        const inverted = (forward && selection.range.end.line === 0) || (!forward && selection.range.start.line === 0);
                        const contentClassNames: string[] = [COLLABORATION_SELECTION_MARKER, `${COLLABORATION_SELECTION_MARKER}-${peerDecoration.peer}`];
                        if (inverted) {
                            contentClassNames.push(COLLABORATION_SELECTION_INVERTED);
                        }
                        const item: EditorDecoration = {
                            range: selection.range,
                            options: {
                                className: `${COLLABORATION_SELECTION} ${COLLABORATION_SELECTION}-${peerDecoration.peer}`,
                                beforeContentClassName: !forward ? contentClassNames.join(' ') : undefined,
                                afterContentClassName: forward ? contentClassNames.join(' ') : undefined,
                            }
                        };
                        return item;
                    }));
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
            const uri = this.getResourceUri(path);
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
            const uri = this.getResourceUri(path);
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
            const uri = this.getResourceUri(path);
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

    protected registerPresenceUpdate(widget: EditorWidget): void {
        const uri = widget.getResourceUri();
        if (uri) {
            const path = this.getProtocolPath(uri);
            if (path) {
                let currentSelection = widget.editor.selection;
                this.toDispose.push(widget.editor.onSelectionChanged(range => {
                    this.options.connection.editor.presence({
                        path,
                        selection: [{
                            range,
                            direction: this.calculateSelectionDirection(currentSelection, range)
                        }]
                    });
                    currentSelection = range;
                }));
            }
        }
    }

    protected calculateSelectionDirection(previous: Range, selection: Range): types.EditorSelectionDirection {
        if (previous.end.line === selection.end.line && previous.end.character === selection.end.character) {
            return types.EditorSelectionDirection.Backward;
        } else {
            return types.EditorSelectionDirection.Forward;
        }
    }

    async initialize(): Promise<void> {
        const response = await this.options.connection.peer.init({
            protocol: PROTOCOL_VERSION
        });
        this.permissions = response.permissions;
        this.readonly = response.permissions.readonly;
        for (const peer of [...response.guests, response.host]) {
            this.addPeer(peer);
        }
        this.fileSystem = new CollaborationFileSystemProvider(this.options.connection);
        this.fileSystem.readonly = this.readonly;
        this.toDispose.push(this.fileService.registerProvider('collaboration', this.fileSystem));
        const workspaceDisposable = await this.workspaceService.setHostWorkspace(response.workspace, this.options.connection);
        this.toDispose.push(workspaceDisposable);
    }

    protected addPeer(peer: types.Peer): void {
        const collection = new DisposableCollection();
        collection.push(this.createPeerStyleSheet(peer));
        collection.push(Disposable.create(() => this.peers.delete(peer.id)));
        const disposablePeer = new CollaborationPeer(peer, collection);
        this.peers.set(peer.id, disposablePeer);
    }

    protected getPeerDecorations(path: string): { peer: string, selection: types.EditorSelection[] }[] {
        const items: { peer: string, selection: types.EditorSelection[] }[] = [];
        for (const peer of this.peers.values()) {
            const selection = peer.decorations.get(path);
            if (selection) {
                items.push({
                    peer: peer.id,
                    selection
                });
            }
        }
        return items;
    }

    protected createPeerStyleSheet(peer: types.Peer): Disposable {
        const style = DecorationStyle.createStyleElement(peer.id);
        const colors = this.collaborationColorService.getColors();
        const sheet = style.sheet!;
        const color = colors[this.colorIndex++ % colors.length];
        const colorString = `rgb(${color.r}, ${color.g}, ${color.b})`;
        sheet.insertRule(`
            .${COLLABORATION_SELECTION}-${peer.id} {
                opacity: 0.2;
                background: ${colorString};
            }
        `);
        sheet.insertRule(`
            .${COLLABORATION_SELECTION_MARKER}-${peer.id} {
                background: ${colorString};
                border-color: ${colorString};
            }`
        );
        sheet.insertRule(`
            .${COLLABORATION_SELECTION_MARKER}-${peer.id}::after {
                content: "${peer.name}";
                background: ${colorString};
                color: ${this.collaborationColorService.requiresDarkFont(color)
                ? this.collaborationColorService.dark
                : this.collaborationColorService.light};
                z-index: ${(100 + this.colorIndex).toFixed()}
            }`
        );
        return Disposable.create(() => style.remove());
    }

    protected getOpenEditors(uri?: URI): EditorWidget[] {
        const widgets = this.shell.widgets;
        let editors = widgets.filter(e => e instanceof EditorWidget) as EditorWidget[];
        if (uri) {
            const uriString = uri.toString();
            editors = editors.filter(e => e.getResourceUri()?.toString() === uriString);
        }
        return editors;
    }

    protected registerModelUpdate(model: MonacoEditorModel): void {
        model.onDidChangeContent(e => {
            if (this.isUpdating) {
                return;
            }
            const path = this.getProtocolPath(new URI(model.uri));
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
            this.options.connection.editor.update({
                path: path,
                content
            });
        });
        const text = this.yjs.getText(model.uri);
        text.insert(0, model.getText());
        text.observe(textEvent => {
            // Disable updating as the edit operation should not be sent to other peers
            this.isUpdating = true;
            let index = 0;
            const operations: ISingleEditOperation[] = [];
            textEvent.delta.forEach(delta => {
                if (delta.retain !== undefined) {
                    index += delta.retain;
                } else if (delta.insert !== undefined) {
                    const pos = model.textEditorModel.getPositionAt(index);
                    const range = new MonacoRange(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
                    const insert = delta.insert as string;
                    operations.push({ range, text: insert });
                    index += insert.length;
                } else if (delta.delete !== undefined) {
                    const pos = model.textEditorModel.getPositionAt(index);
                    const endPos = model.textEditorModel.getPositionAt(index + delta.delete);
                    const range = new MonacoRange(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column);
                    operations.push({ range, text: '' });
                }
            });
            // Push as edit operation so that it is added to the undo/redo stack
            // eslint-disable-next-line no-null/no-null
            model.textEditorModel.pushEditOperations(null, operations, () => null);
            this.isUpdating = false;
        });
    }

    protected getModel(uri: URI): MonacoEditorModel | undefined {
        return this.monacoModelService.models.find(e => e.uri === uri.toString());
    }

    protected getProtocolPath(uri: URI): string | undefined {
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

    protected getResourceUri(path: string): URI | undefined {
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

    dispose(): void {
        this.onDidCloseEmitter.fire();
        this.toDispose.dispose();
    }
}
