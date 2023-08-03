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

import { Container, ContainerModule } from '@theia/core/shared/inversify';
import { CollaborationServer } from './collaboration-server';
import { CredentialsManager } from './credentials-manager';
import { MessageRelay } from './message-relay';
import { PeerFactory, PeerImpl } from './peer';
import { RoomManager } from './room-manager';
import { PeerInfo } from './types';
import { UserManager } from './user-manager';

export default new ContainerModule(bind => {
    bind(CollaborationServer).toSelf().inSingletonScope();
    bind(RoomManager).toSelf().inSingletonScope();
    bind(CredentialsManager).toSelf().inSingletonScope();
    bind(UserManager).toSelf().inSingletonScope();
    bind(MessageRelay).toSelf().inSingletonScope();
    bind(PeerImpl).toSelf().inTransientScope();
    bind(PeerFactory).toFactory(context => (peerInfo: PeerInfo) => {
        const child = new Container();
        child.parent = context.container;
        child.bind(PeerInfo).toConstantValue(peerInfo);
        return child.get(PeerImpl);
    });
});
