import { IAuthenticator } from './types';

/**
 * Authenticator implementation using a shared secret (pre-shared key)
 * Both nodes must possess the same key to successfully handshake
 */
export class ClusterKeyAuthenticator implements IAuthenticator {
    constructor(private readonly sharedKey: string) { }

    async validate(nodeId: string, token: string): Promise<boolean> {
        return token === this.sharedKey;
    }
}
