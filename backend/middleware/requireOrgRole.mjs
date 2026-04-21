// backend/middleware/requireOrgRole.mjs
// Gates a route on the caller's org_memberships role matching an allow list.
// Reads req.params.id as the org id.

export function requireOrgRole(getDb, roles) {
  return (req, res, next) => {
    const db = getDb();
    const m = db.prepare(
      'SELECT role FROM org_memberships WHERE user_id=? AND org_id=?'
    ).get(req.user.email, req.params.id);
    if (!m || !roles.includes(m.role)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    next();
  };
}
