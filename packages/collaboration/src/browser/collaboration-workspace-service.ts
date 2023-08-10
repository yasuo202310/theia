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

import { URI } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { Disposable } from '@theia/core/shared/vscode-languageserver-protocol';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { CollaborationConnection } from '../common/collaboration-connection';
import { WorkspaceEntry, WorkspaceEntryType } from '../common/collaboration-types';

@injectable()
export class CollaborationWorkspaceService extends WorkspaceService {

    protected entries?: WorkspaceEntry[];
    protected connection?: CollaborationConnection;

    async setHostWorkspace(entries: WorkspaceEntry[], connection: CollaborationConnection): Promise<Disposable> {
        this.entries = entries;
        this.connection = connection;
        await this.setWorkspace({
            isDirectory: true,
            isFile: false,
            isReadonly: false,
            isSymbolicLink: false,
            name: 'Collaboration Workspace',
            resource: new URI('collab:///')
        });
        return Disposable.create(() => {
            this.entries = undefined;
            this.connection = undefined;
            this.setWorkspace(undefined);
        });
    }

    protected override async computeRoots(): Promise<FileStat[]> {
        if (this.entries) {
            return this.entries.map(e => this.entryToStat(e));
        } else {
            return super.computeRoots();
        }
    }

    protected entryToStat(entry: WorkspaceEntry): FileStat {
        const uri = new URI('collab:///' + entry.name);
        return {
            resource: uri,
            name: entry.name,
            isDirectory: entry.type === WorkspaceEntryType.DIRECTORY,
            isFile: entry.type === WorkspaceEntryType.FILE,
            isReadonly: false,
            isSymbolicLink: false,
            children: this.childEntriesToStat(uri, entry),
        };
    }

    protected childEntriesToStat(uri: URI, entry: WorkspaceEntry): FileStat[] | undefined {
        if (entry.children.length === 0) {
            return undefined;
        }
        return entry.children.map(e => ({
            name: e.name,
            resource: uri.withPath(uri.path.join(entry.name)),
            isDirectory: e.type === WorkspaceEntryType.DIRECTORY,
            isFile: e.type === WorkspaceEntryType.FILE,
            isReadonly: false,
            isSymbolicLink: false
        }));
    }

}
