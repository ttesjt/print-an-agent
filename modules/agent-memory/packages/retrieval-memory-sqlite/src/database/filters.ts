import type { SQLInputValue } from 'node:sqlite';
import type { MetadataFilter, Primitive } from '@ta-agent/retrieval-memory';
/** Keys/values are parameters. Paths traverse objects, never SQL/JSON-path syntax. */
export function compileMetadataFilter(filter: MetadataFilter): {
  sql: string;
  parameters: SQLInputValue[];
} {
  const parameters: SQLInputValue[] = [];
  let nextAlias = 0;
  const compare = (alias: string, value: Primitive): string => {
    if (value === null) return `${alias}.type='null'`;
    if (typeof value === 'boolean') return `${alias}.type='${value ? 'true' : 'false'}'`;
    parameters.push(value);
    return typeof value === 'number'
      ? `(${alias}.type IN ('integer','real') AND ${alias}.value=?)`
      : `(${alias}.type='text' AND ${alias}.value=?)`;
  };
  const visit = (filter: MetadataFilter): string => {
    if (filter.op === 'and') return `(${filter.filters.map(visit).join(' AND ')})`;
    const path = (column: string, index: number): string => {
      const alias = `rm_json_${nextAlias++}`;
      parameters.push(filter.path[index]!);
      const condition =
        index < filter.path.length - 1
          ? `${alias}.type='object' AND ${path(`${alias}.value`, index + 1)}`
          : filter.op === 'exists'
            ? '1'
            : filter.op === 'eq'
              ? compare(alias, filter.value)
              : `(${filter.values.map((value) => compare(alias, value)).join(' OR ')})`;
      return `EXISTS (SELECT 1 FROM json_each(${column}) ${alias} WHERE ${alias}.key=? AND ${condition})`;
    };
    const expression = path('e2.metadata_json', 0);
    return filter.op === 'exists' && !filter.value ? `NOT ${expression}` : expression;
  };
  return { sql: visit(filter), parameters };
}
