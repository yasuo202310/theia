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
    workspace: WorkspaceEntry[]
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

export interface WorkspaceEntry {
    name: string;
    type: WorkspaceEntryType;
    /**
     * The size of the file.
     *
     * The value may or may not be resolved as
     * it is optional.
     */
    size: number;

    /**
     * The last modification date represented as millis from unix epoch.
     *
     * The value may or may not be resolved as
     * it is optional.
     */
    mtime: number;

    /**
     * The creation date represented as millis from unix epoch.
     *
     * The value may or may not be resolved as
     * it is optional.
     */
    ctime: number;
    children: WorkspaceChildEntry[]
}

export interface WorkspaceChildEntry {
    name: string;
    type: WorkspaceEntryType;
}

export enum WorkspaceEntryType {
    FILE = 0,
    DIRECTORY = 1
}

export interface EditorUpdate {
    uri: string
    range: EditorRange
    text: string
}

export interface EditorRange {
    start: EditorPosition
    end: EditorPosition
}

export interface EditorPosition {
    line: number
    column: number
}
