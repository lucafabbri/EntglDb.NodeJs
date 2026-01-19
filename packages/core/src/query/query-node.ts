
export abstract class QueryNode {
    abstract type: string;
}

export class And extends QueryNode {
    readonly type = 'And';
    constructor(public left: QueryNode, public right: QueryNode) { super(); }
}

export class Or extends QueryNode {
    readonly type = 'Or';
    constructor(public left: QueryNode, public right: QueryNode) { super(); }
}

export class Eq extends QueryNode {
    readonly type = 'Eq';
    constructor(public field: string, public value: any) { super(); }
}

export class Neq extends QueryNode {
    readonly type = 'Neq';
    constructor(public field: string, public value: any) { super(); }
}

export class Gt extends QueryNode {
    readonly type = 'Gt';
    constructor(public field: string, public value: any) { super(); }
}

export class Gte extends QueryNode {
    readonly type = 'Gte';
    constructor(public field: string, public value: any) { super(); }
}

export class Lt extends QueryNode {
    readonly type = 'Lt';
    constructor(public field: string, public value: any) { super(); }
}

export class Lte extends QueryNode {
    readonly type = 'Lte';
    constructor(public field: string, public value: any) { super(); }
}

export class Contains extends QueryNode {
    readonly type = 'Contains';
    constructor(public field: string, public value: string) { super(); }
}
