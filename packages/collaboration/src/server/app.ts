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

import 'reflect-metadata';
import * as yargs from '@theia/core/shared/yargs';
import serverModule from './container';
import { Container } from '@theia/core/shared/inversify';
import { CollaborationServer } from './collaboration-server';

const container = new Container();
container.load(serverModule);
const server = container.get(CollaborationServer);

const command = yargs.version('0.0.1').command<{
    port: number,
    hostname: string
}>({
    command: 'start',
    describe: 'Start the server',
    // Disable this command's `--help` option so that it is forwarded to Theia's CLI
    builder: {
        'port': {
            type: 'number',
            default: 8100
        },
        'hostname': {
            type: 'string',
            default: 'localhost'
        }
    },
    handler: async args => {
        server.startServer(args);
    }
});
command.parse();
