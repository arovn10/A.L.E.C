// backend/middleware/requireConnectorWrite.mjs
// Centralizes connector ACL: loads the instance by :id, enforces canWrite,
// and stashes the row on req.connectorInstance for downstream handlers.

import { canWrite } from '../services/connectorService.mjs';

export function requireConnectorWrite(getDb) {
  return (req, res, next) => {
    const db = getDb();
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!canWrite(db, req.user.email, inst)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    req.connectorInstance = inst;
    next();
  };
}
