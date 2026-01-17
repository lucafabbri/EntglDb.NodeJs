import { Socket } from 'net';

/**
 * Cipher state containing encryption/decryption keys
 */
export class CipherState {
    constructor(
        public readonly encryptKey: Buffer,
        public readonly decryptKey: Buffer
    ) { }
}

/**
 * Interface for peer handshake service
 */
export interface IPeerHandshakeService {
    /**
     * Performs a handshake to establish identity and security context
     * @param socket - Network socket
     * @param isInitiator - True if this peer initiated the connection
     * @param nodeId - This peer's node ID
     * @returns CipherState if encryption is established, or null if plaintext
     */
    handshake(socket: Socket, isInitiator: boolean, nodeId: string): Promise<CipherState | null>;
}

/**
 * Interface for authenticating peer nodes
 */
export interface IAuthenticator {
    /**
     * Validate a peer's credentials
     * @param nodeId - Peer's node ID
     * @param token - Authentication token
     * @returns True if authenticated
     */
    validate(nodeId: string, token: string): Promise<boolean>;
}
