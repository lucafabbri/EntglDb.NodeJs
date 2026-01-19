import { QueryNode, And, Or, Eq, Gt, Gte, Lt, Lte, Neq, Contains } from '@entgldb/core';

export class SqlTranslator {
    static translate(node: QueryNode): { where: string, params: any[] } {
        if (!node) return { where: '1=1', params: [] };
        return this.visit(node);
    }

    private static visit(node: QueryNode): { where: string, params: any[] } {
        switch (node.type) {
            case 'And': return this.visitBinary(node as And, 'AND');
            case 'Or': return this.visitBinary(node as Or, 'OR');
            case 'Eq': return this.visitNary(node as Eq, '=');
            case 'Neq': return this.visitNary(node as Neq, '!=');
            case 'Gt': return this.visitNary(node as Gt, '>');
            case 'Gte': return this.visitNary(node as Gte, '>=');
            case 'Lt': return this.visitNary(node as Lt, '<');
            case 'Lte': return this.visitNary(node as Lte, '<=');
            case 'Contains': return this.visitContains(node as Contains);
            default: throw new Error(`Unknown query node type: ${node.type}`);
        }
    }

    private static visitBinary(node: And | Or, op: string): { where: string, params: any[] } {
        const left = this.visit(node.left);
        const right = this.visit(node.right);
        return {
            where: `(${left.where} ${op} ${right.where})`,
            params: [...left.params, ...right.params]
        };
    }

    private static visitNary(node: Eq | Neq | Gt | Gte | Lt | Lte, op: string): { where: string, params: any[] } {
        // Safe field path construction: assume dot notation
        // field "a.b" -> "$.a.b"
        // We trust field names are safe property names
        const path = `$.${node.field}`;
        return {
            where: `json_extract(data, ?) ${op} ?`,
            params: [path, node.value]
        };
    }

    private static visitContains(node: Contains): { where: string, params: any[] } {
        const path = `$.${node.field}`;
        return {
            where: `json_extract(data, ?) LIKE ?`,
            params: [path, `%${node.value}%`]
        };
    }
}
