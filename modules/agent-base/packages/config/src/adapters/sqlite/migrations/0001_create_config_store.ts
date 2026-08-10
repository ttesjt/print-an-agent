export const CREATE_CONFIG_STORE_MIGRATION = `
  CREATE TABLE ta_agent_base_configs (
    agent_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    value_json TEXT NOT NULL
  ) STRICT;
`;
