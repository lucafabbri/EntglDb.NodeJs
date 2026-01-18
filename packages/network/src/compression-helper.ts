import * as zlib from 'zlib';
import { promisify } from 'util';

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

export class CompressionHelper {
    static readonly THRESHOLD = 1024; // 1KB

    /**
     * Checks if Brotli compression is supported in this environment
     */
    static get isBrotliSupported(): boolean {
        return typeof zlib.brotliCompress === 'function';
    }

    /**
     * Compress data using Brotli
     */
    static async compress(data: Buffer): Promise<Buffer> {
        if (!this.isBrotliSupported) return data;

        return brotliCompress(data, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 4
            }
        });
    }

    /**
     * Decompress data using Brotli
     */
    static async decompress(data: Buffer): Promise<Buffer> {
        if (!this.isBrotliSupported) throw new Error('Brotli not supported');
        return brotliDecompress(data);
    }
}
