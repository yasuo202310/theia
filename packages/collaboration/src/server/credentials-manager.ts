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
import { Deferred } from '@theia/core/lib/common/promise-util';
import { User } from './types';
import { UserManager } from './user-manager';
import jose = require('jose');
import { nanoid } from 'nanoid';

export interface DelayedAuth {
    deferred: Deferred<string>
    dispose: () => void
}

@injectable()
export class CredentialsManager {

    @inject(UserManager)
    protected readonly userManager: UserManager;

    protected deferredAuths = new Map<string, DelayedAuth>();

    protected cachedKey?: string;

    async confirmUser(confirmToken: string, user: Omit<User, 'id'>): Promise<string> {
        const auth = this.deferredAuths.get(confirmToken);
        if (!auth) {
            throw new Error('Login timed out');
        }
        const registeredUser = await this.userManager.registerUser(user);
        const userClaim: User = {
            id: registeredUser.id,
            name: registeredUser.name,
            email: registeredUser.email
        };
        const jwt = await this.generateJwt(userClaim);
        auth.deferred.resolve(jwt);
        auth.dispose();
        return jwt;
    }

    async confirmAuth(confirmToken: string): Promise<string> {
        const deferred = new Deferred<string>();
        const dispose = () => {
            clearTimeout(timeout);
            this.deferredAuths.delete(confirmToken);
            deferred.reject(new Error('Auth request timed out'));
        };
        const timeout = setTimeout(dispose, 300_000); // 5 minutes of timeout
        this.deferredAuths.set(confirmToken, {
            deferred,
            dispose
        });
        return deferred.promise;
    }

    async getUser(token: string): Promise<User | undefined> {
        const user = await this.verifyJwt<User>(token);
        if (typeof user.id !== 'string' || typeof user.name !== 'string') {
            throw new Error('User token is not valid');
        }
        return user;
    }

    async verifyJwt<T extends object>(jwt: string): Promise<T> {
        const key = await this.getJwtPrivateKey();
        const { payload } = await jose.jwtVerify(jwt, key);
        return payload as T;
    }

    protected async getJwtPrivateKey(): Promise<Uint8Array> {
        const key = process.env.JWT_PRIVATE_KEY ?? (this.cachedKey ??= this.secureId());
        return Buffer.from(key);
    }

    async generateJwt(payload: object): Promise<string> {
        const [key, expiration] = await Promise.all([
            this.getJwtPrivateKey(),
            this.getJwtExpiration()
        ]);
        const signJwt = new jose.SignJWT(payload as jose.JWTPayload)
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt();
        if (expiration !== undefined) {
            signJwt.setExpirationTime(expiration);
        }
        return signJwt.sign(key);
    }

    protected async getJwtExpiration(): Promise<string | number | undefined> {
        return undefined;
    }

    secureId(): string {
        return nanoid(24);
    }
}
