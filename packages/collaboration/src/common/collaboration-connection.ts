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

import { Emitter, Event } from '@theia/core';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { io } from 'socket.io-client';
import { Messages } from './collaboration-messages';
import * as types from './collaboration-types';
import {
    BroadcastMessage, BroadcastType, ErrorMessage, Message, NotificationMessage,
    NotificationType, RequestMessage, RequestType, ResponseErrorMessage, ResponseMessage
} from './protocol';

export type Handler<P extends unknown[], R = void> = (...parameters: P) => (R | Promise<R>);
export type BroadcastHandler<P extends unknown[]> = (clientId: string, ...parameters: P) => void;
export type ErrorHandler = (message: string) => void;

export interface RoomHandler {
    onJoin(handler: BroadcastHandler<[types.Peer]>): void;
    onLeave(handler: BroadcastHandler<[types.Peer]>): void;
    onClose(handler: BroadcastHandler<[]>): void;
    onPermissions(handler: BroadcastHandler<[types.Permissions]>): void;
    updatePermissions(permissions: types.Permissions): void;
}

export interface PeerHandler {
    onJoinRequest(handler: Handler<[types.User], boolean>): void;
    onInfo(handler: Handler<[types.Peer]>): void;
    onInit(handler: Handler<[types.InitRequest], types.InitResponse>): void;
    init(request: types.InitRequest): Promise<types.InitResponse>;
}

export interface EditorHandler {
    onUpdate(handler: BroadcastHandler<[types.EditorUpdate]>): void;
    update(update: types.EditorUpdate): void;
    onPresence(handler: BroadcastHandler<[types.EditorPresence]>): void;
    presence(presense: types.EditorPresence): void;
}

export interface FileSystemHandler {
    onReadFile(handler: Handler<[string], string>): void;
    readFile(uri: string): Promise<string>;
    onWriteFile(handler: Handler<[string, string]>): void;
    writeFile(uri: string, content: string): Promise<void>;
    onStat(handler: Handler<[string], types.FileSystemStat>): void;
    stat(uri: string): Promise<types.FileSystemStat>;
    onMkdir(handler: Handler<[string]>): void;
    mkdir(uri: string): Promise<void>;
    onReaddir(handler: Handler<[string], types.FileSystemDirectory>): void;
    readdir(uri: string): Promise<types.FileSystemDirectory>;
    onDelete(handler: Handler<[string]>): void;
    delete(uri: string): Promise<void>;
    onRename(handler: Handler<[string, string]>): void;
    rename(from: string, to: string): Promise<void>;
}

export interface CollaborationConnection extends BroadcastConnection {
    room: RoomHandler;
    peer: PeerHandler;
    fs: FileSystemHandler;
    editor: EditorHandler;
}

export interface BroadcastConnection {
    onRequest<P extends unknown[], R>(type: RequestType<P, R>, handler: Handler<P, R>): void;
    onNotification<P extends unknown[]>(type: NotificationType<P>, handler: Handler<P>): void;
    onBroadcast<P extends unknown[]>(type: BroadcastType<P>, handler: BroadcastHandler<P>): void;
    onError(handler: ErrorHandler): void;
    sendRequest<P extends unknown[], R>(type: RequestType<P, R>, ...parameters: P): Promise<R>;
    sendNotification<P extends unknown[]>(type: NotificationType<P>, ...parameters: P): void;
    sendBroadcast<P extends unknown[]>(type: BroadcastType<P>, ...parameters: P): void;
    dispose(): void;
    onClose: Event<void>;
}

export type ConnectionWriter = (data: unknown) => void;
export type ConnectionReader = (cb: (data: unknown) => void) => void;

export const PROTOCOL_VERSION = '0.1.0';

export interface RelayedRequest {
    id: string | number;
    response: Deferred<unknown>
    dispose(): void;
}

export class Connection implements CollaborationConnection {

    protected messageHandlers = new Map<string, Function>();
    protected onErrorEmitter = new Emitter<string>();
    protected onCloseEmitter = new Emitter<void>();

    get onError(): Event<string> {
        return this.onErrorEmitter.event;
    }

    get onClose(): Event<void> {
        return this.onCloseEmitter.event;
    }

    protected requestMap = new Map<string | number, RelayedRequest>();
    protected requestId = 1;

    room: RoomHandler = {
        onJoin: handler => this.onBroadcast(Messages.Room.Joined, handler),
        onLeave: handler => this.onBroadcast(Messages.Room.Left, handler),
        onClose: handler => this.onBroadcast(Messages.Room.Closed, handler),
        onPermissions: handler => this.onBroadcast(Messages.Room.PermissionsUpdated, handler),
        updatePermissions: permissions => this.sendBroadcast(Messages.Room.PermissionsUpdated, permissions)
    };

    peer: PeerHandler = {
        onJoinRequest: handler => this.onRequest(Messages.Peer.Join, handler),
        onInfo: handler => this.onNotification(Messages.Peer.Info, handler),
        onInit: handler => this.onRequest(Messages.Peer.Init, handler),
        init: request => this.sendRequest(Messages.Peer.Init, request)
    };

    fs: FileSystemHandler = {
        onReadFile: handler => this.onRequest(Messages.FileSystem.ReadFile, handler),
        readFile: uri => this.sendRequest(Messages.FileSystem.ReadFile, uri),
        onWriteFile: handler => this.onRequest(Messages.FileSystem.WriteFile, handler),
        writeFile: (uri, content) => this.sendRequest(Messages.FileSystem.WriteFile, uri, content),
        onReaddir: handler => this.onRequest(Messages.FileSystem.ReadDir, handler),
        readdir: uri => this.sendRequest(Messages.FileSystem.ReadDir, uri),
        onStat: handler => this.onRequest(Messages.FileSystem.Stat, handler),
        stat: uri => this.sendRequest(Messages.FileSystem.Stat, uri),
        onMkdir: handler => this.onRequest(Messages.FileSystem.Mkdir, handler),
        mkdir: uri => this.sendRequest(Messages.FileSystem.Mkdir, uri),
        onDelete: handler => this.onRequest(Messages.FileSystem.Delete, handler),
        delete: uri => this.sendRequest(Messages.FileSystem.Delete, uri),
        onRename: handler => this.onRequest(Messages.FileSystem.Rename, handler),
        rename: (from, to) => this.sendRequest(Messages.FileSystem.Rename, from, to)
    };

    editor: EditorHandler = {
        onUpdate: handler => this.onBroadcast(Messages.Editor.Update, handler),
        update: editorUpdate => this.sendBroadcast(Messages.Editor.Update, editorUpdate),
        onPresence: handler => this.onBroadcast(Messages.Editor.Presence, handler),
        presence: presenceUpdate => this.sendBroadcast(Messages.Editor.Presence, presenceUpdate)
    };

    constructor(readonly writer: ConnectionWriter, readonly reader: ConnectionReader, protected readonly _dispose?: () => void) {
        reader(data => this.handleMessage(data));
    }

    dispose(): void {
        this.onCloseEmitter.fire();
        this.onCloseEmitter.dispose();
        this.onErrorEmitter.dispose();
        this.messageHandlers.clear();
        this._dispose?.();
    }

    protected handleMessage(message: unknown): void {
        if (Message.is(message)) {
            if (ResponseMessage.is(message) || ResponseErrorMessage.is(message)) {
                const request = this.requestMap.get(message.id);
                if (request) {
                    if (ResponseMessage.is(message)) {
                        request.response.resolve(message.response);
                    } else {
                        request.response.reject(message.message);
                    }
                }
            } else if (RequestMessage.is(message)) {
                const handler = this.messageHandlers.get(message.method);
                if (!handler) {
                    console.error(`No handler registered for ${message.kind} method ${message.method}.`);
                    return;
                }
                try {
                    const result = handler(...(message.params ?? []));
                    Promise.resolve(result).then(value => {
                        const responseMessage = ResponseMessage.create(message.id, value);
                        this.writer(responseMessage);
                    }, error => {
                        const responseErrorMessage = ResponseErrorMessage.create(message.id, error.message);
                        this.writer(responseErrorMessage);
                    });
                } catch (error) {
                    const responseErrorMessage = ResponseErrorMessage.create(message.id, error.message);
                    this.writer(responseErrorMessage);
                }
            } else if (BroadcastMessage.is(message) || NotificationMessage.is(message)) {
                const handler = this.messageHandlers.get(message.method);
                if (!handler) {
                    console.error(`No handler registered for ${message.kind} method ${message.method}.`);
                    return;
                }
                if (BroadcastMessage.is(message)) {
                    handler(message.clientId, ...(message.params ?? []));
                } else {
                    handler(...(message.params ?? []));
                }
            } else if (ErrorMessage.is(message)) {
                this.onErrorEmitter.fire(message.message);
            }
        }
    }

    onRequest<P extends unknown[], R>(type: RequestType<P, R>, handler: Handler<P, R>): void {
        this.messageHandlers.set(type.method, handler);
    }

    onNotification<P extends unknown[]>(type: NotificationType<P>, handler: Handler<P>): void {
        this.messageHandlers.set(type.method, handler);
    }

    onBroadcast<P extends unknown[]>(type: BroadcastType<P>, handler: BroadcastHandler<P>): void {
        this.messageHandlers.set(type.method, handler);
    }

    sendRequest<P extends unknown[], R>(type: RequestType<P, R>, ...parameters: P): Promise<R> {
        const id = this.requestId++;
        const deferred = new Deferred<R>();
        const dispose = () => {
            this.requestMap.delete(id);
            clearTimeout(timeout);
            deferred.reject(new Error('Request timed out'));
        };
        const timeout = setTimeout(dispose, 60_000); // Timeout after one minute
        const relayedMessage: RelayedRequest = {
            id,
            response: deferred,
            dispose
        };
        this.requestMap.set(id, relayedMessage);
        const message = RequestMessage.create(type, id, parameters);
        this.writer(message);
        return deferred.promise;
    }

    sendNotification<P extends unknown[]>(type: NotificationType<P>, ...parameters: P): void {
        const message = NotificationMessage.create(type, parameters);
        this.writer(message);
    }

    sendBroadcast<P extends unknown[]>(type: BroadcastType<P>, ...parameters: P): void {
        const message = BroadcastMessage.create(type, '', parameters);
        this.writer(message);
    }
}

export class CollaborationAuthHandler {

    constructor(readonly url: string, userToken: string | undefined, readonly opener: (url: string) => void) {
        this.userAuthToken = userToken;
    }

    protected userAuthToken?: string;
    protected roomAuthToken?: string;

    get authToken(): string | undefined {
        return this.userAuthToken;
    }

    protected getUrl(path: string): string {
        return `${this.url}${path}`;
    }

    async login(): Promise<string> {
        const loginResponse = await fetch(this.getUrl('/api/login/url'), {
            method: 'POST'
        });
        const loginBody = await loginResponse.json();
        const confirmToken = loginBody.token;
        const url = loginBody.url as string;
        const fullUrl = url.startsWith('/') ? this.getUrl(url) : url;
        this.opener(fullUrl);
        const confirmResponse = await fetch(this.getUrl(`/api/login/confirm/${confirmToken}`), {
            method: 'POST'
        });
        const confirmBody = await confirmResponse.json();
        this.userAuthToken = confirmBody.token;
        return confirmBody.token;
    }

    async validate(): Promise<boolean> {
        if (this.userAuthToken) {
            const validateResponse = await fetch(this.getUrl('/api/login/validate'), {
                method: 'POST',
                headers: {
                    'x-jwt': this.userAuthToken!
                }
            });
            const validateBody = await validateResponse.text();
            return validateBody === 'true';
        } else {
            return false;
        }
    }

    async createRoom(): Promise<{ login?: string, room: string }> {
        const valid = await this.validate();
        let login: string | undefined;
        if (!valid) {
            login = await this.login();
        }
        const response = await fetch(this.getUrl('/api/session/create'), {
            method: 'POST',
            headers: {
                'x-jwt': this.userAuthToken!
            }
        });
        const body = await response.json();
        this.roomAuthToken = body.token;
        return {
            login,
            room: body.room
        };
    }

    async joinRoom(id: string): Promise<{ login?: string }> {
        const valid = await this.validate();
        let login: string | undefined;
        if (!valid) {
            login = await this.login();
        }
        const response = await fetch(this.getUrl(`/api/session/join/${id}`), {
            method: 'POST',
            headers: {
                'x-jwt': this.userAuthToken!
            }
        });
        const body = await response.json();
        this.roomAuthToken = body.token;
        return {
            login
        };
    }

    connect(): CollaborationConnection {
        const socket = io(this.getUrl(''), {
            extraHeaders: {
                'x-jwt': this.roomAuthToken!
            }
        });
        const connection = new Connection(
            data => socket.emit('message', data),
            cb => socket.on('message', cb),
            () => socket.close()
        );
        socket.connect();
        socket.on('disconnect', () => {
            connection.dispose();
        });
        return connection;
    }
}
