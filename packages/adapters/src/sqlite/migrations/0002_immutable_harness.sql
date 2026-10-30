CREATE TRIGGER harness_versions_reject_update
BEFORE UPDATE ON harness_versions
BEGIN
  SELECT RAISE(ABORT, 'harness_versions rows are immutable: UPDATE is not allowed');
END;

CREATE TRIGGER harness_versions_reject_delete
BEFORE DELETE ON harness_versions
BEGIN
  SELECT RAISE(ABORT, 'harness_versions rows are immutable: DELETE is not allowed');
END;
