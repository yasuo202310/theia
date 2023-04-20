// *****************************************************************************
// Copyright (C) 2023 Ericsson and others.
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
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
// *****************************************************************************

import { createIpcNamespace, preloadServiceIdentifier } from '@theia/core/lib/electron-common';

export const ELECTRON_FILE_DIALOG_IPC = createIpcNamespace('theia-electron-file-dialog', channel => ({
    showOpenDialog: channel<(cwd: string, options?: OpenDialogOptions) => Promise<string[] | undefined>>(),
    showSaveDialog: channel<(cwd: string, options?: SaveDialogOptions) => Promise<string | undefined>>()
}));

export const ElectronFileDialog = preloadServiceIdentifier<ElectronFileDialog>('ElectronFileDialog');
export interface ElectronFileDialog {
    showOpenDialog(cwd: string, options?: OpenDialogOptions): Promise<string[] | undefined>;
    showSaveDialog(cwd: string, options?: SaveDialogOptions): Promise<string | undefined>;
}

export interface FileFilter {
    name: string;
    extensions: string[];
}

export interface OpenDialogOptions {
    title?: string,
    maxWidth?: number,
    buttonLabel?: string,
    modal?: boolean,
    openFiles?: boolean,
    openFolders?: boolean;
    selectMany?: boolean;
    filters?: FileFilter[];
}

export interface SaveDialogOptions {
    title?: string,
    maxWidth?: number,
    buttonLabel?: string,
    modal?: boolean,
    filters?: FileFilter[];
}