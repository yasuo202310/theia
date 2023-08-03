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

import { inject, injectable } from '@theia/core/shared/inversify';
import { v4 } from 'uuid';
import { User } from './types';
import { UserManager } from './user-manager';

@injectable()
export class CredentialsManager {

    @inject(UserManager)
    protected readonly userManager: UserManager;

    protected tokensToId = new Map<string, string>();

    async assignAuthToken(user: User): Promise<string> {
        const token = v4();
        this.tokensToId.set(token, user.id);
        return token;
    }

    async getUser(token: string): Promise<User | undefined> {
        const userId = this.tokensToId.get(token);
        if (!userId) {
            return undefined;
        }
        return this.userManager.getUser(userId);
    }

}
