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

import { CommandContribution } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { CollaborationFrontendContribution } from './collaboration-frontend-contribution';
import { CollaborationWorkspaceService } from './collaboration-workspace-service';

export default new ContainerModule((bind, _, __, rebind) => {
    bind(CollaborationWorkspaceService).toSelf().inSingletonScope();
    rebind(WorkspaceService).toService(CollaborationWorkspaceService);
    bind(CollaborationFrontendContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(CollaborationFrontendContribution);
});
