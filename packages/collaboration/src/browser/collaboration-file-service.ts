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

import { Disposable, URI } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ResolveMetadataFileOptions, FileStatWithMetadata, ResolveFileOptions, FileStat } from '@theia/filesystem/lib/common/files';
import { CollaborationConnection } from '../common/collaboration-connection';
import { WorkspaceEntry, WorkspaceEntryType } from '../common/collaboration-types';

@injectable()
export class CollaborationFileService extends FileService {

    protected connection?: CollaborationConnection;

    setConnection(connection: CollaborationConnection): Disposable {
        this.connection = connection;
        return Disposable.create(() => this.connection = undefined);
    }

    override resolve(resource: URI, options: ResolveMetadataFileOptions): Promise<FileStatWithMetadata>;
    override resolve(resource: URI, options?: ResolveFileOptions): Promise<FileStat>;
    override async resolve(resource: URI, options?: ResolveFileOptions | ResolveMetadataFileOptions): Promise<FileStat> {
        if (this.connection) {
            const path = resource.path;
            const entry = await this.connection.workspace.entry(path.toString());
            return this.entryToStat(resource, entry);
        } else {
            return super.resolve(resource, options);
        }

    }

    protected entryToStat(uri: URI, entry: WorkspaceEntry): FileStat {
        return {
            resource: uri,
            name: entry.name,
            isDirectory: entry.type === WorkspaceEntryType.DIRECTORY,
            isFile: entry.type === WorkspaceEntryType.FILE,
            isReadonly: false,
            isSymbolicLink: false,
            children: this.childEntriesToStat(uri, entry),
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.size
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
