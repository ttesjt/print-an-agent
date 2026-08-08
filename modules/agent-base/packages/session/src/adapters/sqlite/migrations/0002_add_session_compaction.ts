export const ADD_SESSION_COMPACTION_MIGRATION = `
  CREATE TABLE ta_agent_base_session_compactions (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    through_turn_id TEXT NOT NULL,
    context_message TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id),
    FOREIGN KEY (agent_id, session_id)
      REFERENCES ta_agent_base_sessions (agent_id, session_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, through_turn_id)
      REFERENCES ta_agent_base_session_turns (agent_id, session_id, turn_id)
  ) STRICT;
`;
