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

export interface User {
    name: string
    email?: string
}

export interface Peer {
    id: string
    name: string
    email?: string
}

export interface InitRequest {
}

export interface InitResponse {
    host: Peer;
    guests: Peer[];
    permissions: Permissions;
    capabilities: Capabilities;
    workspace: Workspace
}

export interface Workspace {
    name: string
    folders: string[]
}

export interface Capabilities {

}

export interface Room {
    id: string
    host: Peer
    guests: Peer[]
    permissions: Permissions
}

export type Permissions = Record<string, string>;

export interface FileSystemStat {
    type: FileType;
    mtime: number;
    ctime: number;
    size: number;
    permissions?: FilePermission;
}

export interface FileSystemDirectory {
    [name: string]: FileType
}

export enum FilePermission {
    /**
     * File is readonly.
     */
    Readonly = 1
}

export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64
}

export interface EditorUpdate {
    path: string
    content: EditorContentUpdate[]
}

export interface EditorContentUpdate {
    range: EditorRange
    text: string
}

export interface EditorRange {
    start: EditorPosition
    end: EditorPosition
}

export interface EditorPosition {
    line: number
    character: number
}

export interface EditorPresence {
    path: string
    selection: EditorRange[]
}
