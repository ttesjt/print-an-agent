export const ADD_SESSION_NAVIGATION_MIGRATION = `
  ALTER TABLE ta_agent_base_sessions
    ADD COLUMN selected_branch_id TEXT NOT NULL DEFAULT 'main';

  ALTER TABLE ta_agent_base_sessions
    ADD COLUMN navigation_revision INTEGER NOT NULL DEFAULT 0 CHECK (navigation_revision >= 0);

  ALTER TABLE ta_agent_base_session_turns
    ADD COLUMN branch_id TEXT NOT NULL DEFAULT 'main';

  ALTER TABLE ta_agent_base_session_turns
    ADD COLUMN parent_turn_id TEXT;

  UPDATE ta_agent_base_session_turns AS current_turn
  SET parent_turn_id = (
    SELECT previous_turn.turn_id
    FROM ta_agent_base_session_turns AS previous_turn
    WHERE previous_turn.agent_id = current_turn.agent_id
      AND previous_turn.session_id = current_turn.session_id
      AND previous_turn.status = 'completed'
      AND previous_turn.turn_sequence < current_turn.turn_sequence
    ORDER BY previous_turn.turn_sequence DESC
    LIMIT 1
  );

  CREATE TABLE ta_agent_base_session_branches (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    parent_branch_id TEXT,
    forked_from_turn_id TEXT,
    head_turn_id TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id)
      REFERENCES ta_agent_base_sessions (agent_id, session_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, parent_branch_id)
      REFERENCES ta_agent_base_session_branches (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id, forked_from_turn_id)
      REFERENCES ta_agent_base_session_turns (agent_id, session_id, turn_id),
    FOREIGN KEY (agent_id, session_id, head_turn_id)
      REFERENCES ta_agent_base_session_turns (agent_id, session_id, turn_id),
    CHECK (
      (parent_branch_id IS NULL AND forked_from_turn_id IS NULL)
      OR
      (parent_branch_id IS NOT NULL AND forked_from_turn_id IS NOT NULL)
    )
  ) STRICT;

  INSERT INTO ta_agent_base_session_branches
    (agent_id, session_id, branch_id, head_turn_id, created_at)
  SELECT
    session.agent_id,
    session.session_id,
    'main',
    (
      SELECT turn.turn_id
      FROM ta_agent_base_session_turns AS turn
      WHERE turn.agent_id = session.agent_id
        AND turn.session_id = session.session_id
        AND turn.status = 'completed'
      ORDER BY turn.turn_sequence DESC
      LIMIT 1
    ),
    session.created_at
  FROM ta_agent_base_sessions AS session;

  CREATE TABLE ta_agent_base_session_compactions_next (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    through_turn_id TEXT NOT NULL,
    context_message TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id, branch_id),
    FOREIGN KEY (agent_id, session_id, branch_id)
      REFERENCES ta_agent_base_session_branches (agent_id, session_id, branch_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, through_turn_id)
      REFERENCES ta_agent_base_session_turns (agent_id, session_id, turn_id)
  ) STRICT;

  INSERT INTO ta_agent_base_session_compactions_next
    (agent_id, session_id, branch_id, revision, through_turn_id, context_message, created_at)
  SELECT
    agent_id,
    session_id,
    'main',
    revision,
    through_turn_id,
    context_message,
    created_at
  FROM ta_agent_base_session_compactions;

  DROP TABLE ta_agent_base_session_compactions;
  ALTER TABLE ta_agent_base_session_compactions_next
    RENAME TO ta_agent_base_session_compactions;
`;
