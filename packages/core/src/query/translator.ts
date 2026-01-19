import { QueryNode, And, Or, Eq, Gt, Gte, Lt, Lte, Neq, Contains } from './query-node';

export interface QueryOptions {
    /**
     * Function to transform property names (e.g. camelCase to snake_case)
     */
    namingStrategy?: (prop: string) => string;
}

/**
 * Translates a MongoDB-like query object to a QueryNode tree.
 * Example: { name: "Fabio", age: { $gt: 18 } }
 */
export class ObjectToQueryNodeTranslator {

    static translate(query: any, options?: QueryOptions): QueryNode | null {
        if (!query || Object.keys(query).length === 0) return null;

        const nodes: QueryNode[] = [];

        for (const key of Object.keys(query)) {
            const value = query[key];
            const fieldName = options?.namingStrategy ? options.namingStrategy(key) : key;

            if (key === '$or') {
                if (Array.isArray(value)) {
                    const subNodes = value.map(v => this.translate(v, options)).filter(n => n !== null) as QueryNode[];
                    if (subNodes.length > 0) {
                        let combined = subNodes[0];
                        for (let i = 1; i < subNodes.length; i++) {
                            combined = new Or(combined, subNodes[i]);
                        }
                        nodes.push(combined);
                    }
                }
                continue;
            }

            if (key === '$and') {
                if (Array.isArray(value)) {
                    const subNodes = value.map(v => this.translate(v, options)).filter(n => n !== null) as QueryNode[];
                    subNodes.forEach(n => nodes.push(n));
                }
                continue;
            }

            // Primitive value check (e.g. { field: "value" } -> implies Eq)
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                nodes.push(new Eq(fieldName, value));
                continue;
            }

            // Operator check (e.g. { field: { $gt: 10 } })
            for (const op of Object.keys(value)) {
                const opVal = value[op];
                switch (op) {
                    case '$eq': nodes.push(new Eq(fieldName, opVal)); break;
                    case '$neq': nodes.push(new Neq(fieldName, opVal)); break;
                    case '$gt': nodes.push(new Gt(fieldName, opVal)); break;
                    case '$gte': nodes.push(new Gte(fieldName, opVal)); break;
                    case '$lt': nodes.push(new Lt(fieldName, opVal)); break;
                    case '$lte': nodes.push(new Lte(fieldName, opVal)); break;
                    case '$contains': nodes.push(new Contains(fieldName, opVal)); break;
                    default:
                        // If it's not a known operator, maybe it's just a nested object Eq?
                        // For now let's assume valid operators or fallback to Eq? 
                        // Actually in mongo {a: {b:1}} is exact match.
                        // EntglDb is flat mostly. Let's throw or ignore.
                        console.warn(`Unknown operator ${op} for field ${fieldName}`);
                        break;
                }
            }
        }

        if (nodes.length === 0) return null;
        if (nodes.length === 1) return nodes[0];

        // Combine all implicit ANDs
        let result = nodes[0];
        for (let i = 1; i < nodes.length; i++) {
            result = new And(result, nodes[i]);
        }
        return result;
    }
}
