CREATE UNIQUE INDEX agents_id_domain_unique ON agents (id, domain_id);

CREATE TRIGGER rounds_validate_scope_insert
BEFORE INSERT ON rounds
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM agents WHERE id = NEW.agent_id AND domain_id = NEW.domain_id
)
BEGIN
  SELECT RAISE(ABORT, 'round scope must match agent scope');
END;

CREATE TRIGGER rounds_reject_scope_update
BEFORE UPDATE OF agent_id, domain_id, created_at ON rounds
FOR EACH ROW
WHEN NEW.agent_id <> OLD.agent_id
  OR NEW.domain_id <> OLD.domain_id
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'round identity and scope are immutable');
END;

CREATE TRIGGER harness_versions_validate_scope_insert
BEFORE INSERT ON harness_versions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM agents WHERE id = NEW.agent_id AND domain_id = NEW.domain_id
)
BEGIN
  SELECT RAISE(ABORT, 'harness scope must match agent scope');
END;

CREATE TRIGGER executions_validate_scope_insert
BEFORE INSERT ON executions
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1 FROM rounds
  WHERE id = NEW.round_id
    AND agent_id = NEW.agent_id
    AND domain_id = NEW.domain_id
)
OR NOT EXISTS (
  SELECT 1 FROM cases
  WHERE id = NEW.case_id
    AND agent_id = NEW.agent_id
    AND domain_id = NEW.domain_id
)
BEGIN
  SELECT RAISE(ABORT, 'execution scope must match round and case scope');
END;

CREATE TRIGGER connections_validate_scope_insert
BEFORE INSERT ON connections FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM agents WHERE id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'connection scope must match agent scope'); END;

CREATE TRIGGER capabilities_validate_scope_insert
BEFORE INSERT ON capabilities FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM agents WHERE id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'capability scope must match agent scope'); END;

CREATE TRIGGER cases_validate_scope_insert
BEFORE INSERT ON cases FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM agents WHERE id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'case scope must match agent scope'); END;

CREATE TRIGGER case_partitions_validate_scope_insert
BEFORE INSERT ON case_partitions FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM cases WHERE id = NEW.case_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'partition scope must match case scope'); END;

CREATE TRIGGER findings_validate_scope_insert
BEFORE INSERT ON findings FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM rounds WHERE id = NEW.round_id AND agent_id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'finding scope must match round scope'); END;

CREATE TRIGGER proposals_validate_scope_insert
BEFORE INSERT ON proposals FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM rounds WHERE id = NEW.round_id AND agent_id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'proposal scope must match round scope'); END;

CREATE TRIGGER evaluations_validate_scope_insert
BEFORE INSERT ON evaluations FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM rounds WHERE id = NEW.round_id AND agent_id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'evaluation scope must match round scope'); END;

CREATE TRIGGER learnings_validate_scope_insert
BEFORE INSERT ON learnings FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM rounds WHERE id = NEW.round_id AND agent_id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'learning scope must match round scope'); END;

CREATE TRIGGER exports_validate_scope_insert
BEFORE INSERT ON exports FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM rounds WHERE id = NEW.round_id AND agent_id = NEW.agent_id AND domain_id = NEW.domain_id)
BEGIN SELECT RAISE(ABORT, 'export scope must match round scope'); END;
