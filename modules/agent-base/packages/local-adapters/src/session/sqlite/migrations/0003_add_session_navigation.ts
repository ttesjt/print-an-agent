import { quoteSqliteIdentifier } from '../table-names.js';
import {
  sessionCompactionMigrationTableName,
  type SqliteSessionTableNames,
} from '../table-names.js';

export function addSessionNavigationMigration(tableNames: SqliteSessionTableNames): string {
  const compactionStagingTable = sessionCompactionMigrationTableName(tableNames);
  return `
  ALTER TABLE ${quoteSqliteIdentifier(tableNames.sessions)}
    ADD COLUMN selected_branch_id TEXT NOT NULL DEFAULT 'main';

  ALTER TABLE ${quoteSqliteIdentifier(tableNames.sessions)}
    ADD COLUMN navigation_revision INTEGER NOT NULL DEFAULT 0 CHECK (navigation_revision >= 0);

  ALTER TABLE ${quoteSqliteIdentifier(tableNames.turns)}
    ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main';

  ALTER TABLE ${quoteSqliteIdentifier(tableNames.turns)}
    ADD COLUMN parent_turn_id TEXT;

  UPDATE ${quoteSqliteIdentifier(tableNames.turns)} AS current_turn
  SET parent_turn_id = (
    SELECT previous_turn.turn_id
    FROM ${quoteSqliteIdentifier(tableNames.turns)} AS previous_turn
    WHERE previous_turn.agent_id = current_turn.agent_id
      AND previous_turn.session_id = current_turn.session_id
      AND previous_turn.status = 'completed'
      AND previous_turn.turn_sequence < current_turn.turn_sequence
    ORDER BY previous_turn.turn_sequence DESC
    LIMIT 1
  );

  CREATE TABLE ${quoteSqliteIdentifier(tableNames.branches)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    parent_branch_id TEXT,
    forked_from_turn_id TEXT,
    head_turn_id TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.sessions)} (agent_id, session_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, parent_branch_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.branches)} (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id, forked_from_turn_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.turns)} (agent_id, session_id, turn_id),
    FOREIGN KEY (agent_id, session_id, head_turn_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.turns)} (agent_id, session_id, turn_id),
    CHECK (
      (parent_branch_id IS NULL AND forked_from_turn_id IS NULL)
      OR
      (parent_branch_id IS NOT NULL AND forked_from_turn_id IS NOT NULL)
    )
  ) STRICT;

  INSERT INTO ${quoteSqliteIdentifier(tableNames.branches)}
    (agent_id, session_id, branch_id, head_turn_id, created_at)
  SELECT
    session.agent_id,
    session.session_id,
    'main',
    (
      SELECT turn.turn_id
      FROM ${quoteSqliteIdentifier(tableNames.turns)} AS turn
      WHERE turn.agent_id = session.agent_id
        AND turn.session_id = session.session_id
        AND turn.status = 'completed'
      ORDER BY turn.turn_sequence DESC
      LIMIT 1
    ),
    session.created_at
  FROM ${quoteSqliteIdentifier(tableNames.sessions)} AS session;

  CREATE TABLE ${quoteSqliteIdentifier(compactionStagingTable)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    through_turn_id TEXT NOT NULL,
    context_message TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id, branch_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.branches)} (agent_id, session_id, branch_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, through_turn_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.turns)} (agent_id, session_id, turn_id)
  ) STRICT;

  INSERT INTO ${quoteSqliteIdentifier(compactionStagingTable)}
    (agent_id, session_id, branch_id, revision, through_turn_id, context_message, created_at)
  SELECT
    agent_id,
    session_id,
    'main',
    revision,
    through_turn_id,
    context_message,
    created_at
  FROM ${quoteSqliteIdentifier(tableNames.compactions)};

  DROP TABLE ${quoteSqliteIdentifier(tableNames.compactions)};
  ALTER TABLE ${quoteSqliteIdentifier(compactionStagingTable)}
    RENAME TO ${quoteSqliteIdentifier(tableNames.compactions)};
`;
}
