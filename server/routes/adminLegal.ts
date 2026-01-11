import { Router, Request, Response } from 'express';
import { z } from 'zod';
import BetterSQLite3 from 'better-sqlite3';
import { sha256 } from '../legal/cryptoUtils';
import { getCoverageStats, isEnforcementEnabled, setEnforcementEnabled } from '../legal/coverageGate';
import { REGIONS, getCountriesInRegion, buildScopeKeys } from '../legal/regionRules';

const router = Router();

// Admin auth middleware (applied to all routes)
router.use((req: Request, res: Response, next) => {
  if (!(req as any).session?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
});

// ==================== DOCUMENTS CRUD ====================

// GET /api/admin/legal-docs - List all documents with pagination
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const docType = req.query.docType as string;
    const scopeKey = req.query.scopeKey as string;
    
    const db = new BetterSQLite3('./trading_app.db');
    try {
      let query = 'SELECT * FROM legal_documents WHERE 1=1';
      const params: any[] = [];
      
      if (docType) {
        query += ' AND doc_type = ?';
        params.push(docType);
      }
      if (scopeKey) {
        query += ' AND scope_key = ?';
        params.push(scopeKey);
      }
      
      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      
      const docs = db.prepare(query).all(...params);
      const total = db.prepare('SELECT COUNT(*) as count FROM legal_documents').get() as { count: number };
      
      res.json({
        documents: docs,
        pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
      });
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('[AdminLegal] Error listing documents:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/legal-docs/:id - Get single document
router.get('/:id', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } finally {
    db.close();
  }
});

// POST /api/admin/legal-docs - Create new document
router.post('/', async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      docType: z.enum(['GLOBAL_MASTER_TERMS', 'REGION_ADDENDUM', 'COUNTRY_ADDENDUM']),
      scopeKey: z.string().min(1),
      version: z.string().regex(/^\d+\.\d+\.\d+$/),
      locale: z.string().default('en'),
      title: z.string().min(1),
      body: z.string().min(1),
    });
    
    const data = schema.parse(req.body);
    const contentHash = sha256(data.body);
    const adminId = (req as any).session.userId;
    
    const db = new BetterSQLite3('./trading_app.db');
    try {
      const result = db.prepare(`
        INSERT INTO legal_documents (doc_type, scope_key, version, locale, title, body, content_hash, is_active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, strftime('%s', 'now'))
      `).run(data.docType, data.scopeKey, data.version, data.locale, data.title, data.body, contentHash, adminId);
      
      // Audit log
      db.prepare(`
        INSERT INTO legal_doc_change_audit (doc_id, action, changed_by, new_value)
        VALUES (?, 'CREATED', ?, ?)
      `).run(result.lastInsertRowid, adminId, JSON.stringify(data));
      
      const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(result.lastInsertRowid);
      res.status(201).json(doc);
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues });
    console.error('[AdminLegal] Error creating document:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/admin/legal-docs/:id - Update document
router.patch('/:id', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id) as any;
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (doc.is_active) return res.status(400).json({ error: 'Cannot edit active document' });
    
    const schema = z.object({
      title: z.string().min(1).optional(),
      body: z.string().min(1).optional(),
      version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    });
    
    const data = schema.parse(req.body);
    const adminId = (req as any).session.userId;
    const newHash = data.body ? sha256(data.body) : doc.content_hash;
    
    db.prepare(`
      UPDATE legal_documents 
      SET title = COALESCE(?, title), body = COALESCE(?, body), version = COALESCE(?, version),
          content_hash = ?, updated_by = ?, updated_at = strftime('%s', 'now')
      WHERE id = ?
    `).run(data.title || null, data.body || null, data.version || null, newHash, adminId, req.params.id);
    
    db.prepare(`
      INSERT INTO legal_doc_change_audit (doc_id, action, changed_by, previous_value, new_value)
      VALUES (?, 'UPDATED', ?, ?, ?)
    `).run(req.params.id, adminId, JSON.stringify(doc), JSON.stringify(data));
    
    const updated = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id);
    res.json(updated);
  } finally {
    db.close();
  }
});

// POST /api/admin/legal-docs/:id/activate - Activate document
router.post('/:id/activate', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const doc = db.prepare('SELECT * FROM legal_documents WHERE id = ?').get(req.params.id) as any;
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    
    const adminId = (req as any).session.userId;
    
    db.prepare(`UPDATE legal_documents SET is_active = 1, activated_at = strftime('%s', 'now'), activated_by = ? WHERE id = ?`).run(adminId, req.params.id);
    
    // Update or create target
    const existingTarget = db.prepare('SELECT * FROM legal_doc_targets WHERE scope_key = ?').get(doc.scope_key);
    if (existingTarget) {
      db.prepare('UPDATE legal_doc_targets SET active_doc_id = ?, updated_by = ?, updated_at = strftime(\'%s\', \'now\') WHERE scope_key = ?').run(doc.id, adminId, doc.scope_key);
    } else {
      db.prepare('INSERT INTO legal_doc_targets (scope_key, active_doc_id, updated_by) VALUES (?, ?, ?)').run(doc.scope_key, doc.id, adminId);
    }
    
    db.prepare(`INSERT INTO legal_doc_change_audit (doc_id, action, changed_by) VALUES (?, 'ACTIVATED', ?)`).run(req.params.id, adminId);
    
    res.json({ success: true, message: 'Document activated and set as target' });
  } finally {
    db.close();
  }
});

// ==================== TARGETS ====================

// GET /api/admin/legal-docs/targets - List all targets (pointers)
router.get('/targets/list', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const targets = db.prepare(`
      SELECT p.*, 
             d.doc_set || '/' || d.doc_type || '/' || d.jurisdiction_type || '/' || d.jurisdiction_key as doc_title, 
             d.version as doc_version, 
             d.doc_type
      FROM legal_doc_pointers p
      LEFT JOIN legal_documents d ON p.active_document_id = d.id
      ORDER BY p.doc_set, p.jurisdiction_type, p.jurisdiction_key
    `).all();
    res.json({ ok: true, targets });
  } catch (err: any) {
    res.json({ ok: false, error: err.message, targets: [] });
  } finally {
    db.close();
  }
});

// ==================== ACCEPTANCES ====================

// GET /api/admin/legal-acceptances - List acceptances with pagination
router.get('/acceptances/list', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const userId = req.query.userId as string;
    
    let query = `
      SELECT a.*, u.email, u.username, 
             d.doc_set || '/' || d.doc_type as doc_title, 
             d.version as current_doc_version
      FROM legal_acceptances a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN legal_documents d ON a.global_doc_id = d.id
    `;
    const params: any[] = [];
    
    if (userId) {
      query += ' WHERE a.user_id = ?';
      params.push(userId);
    }
    
    query += ' ORDER BY a.accepted_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    
    const acceptances = db.prepare(query).all(...params);
    const total = db.prepare('SELECT COUNT(*) as count FROM legal_acceptances').get() as { count: number };
    
    res.json({
      ok: true,
      acceptances,
      pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
    });
  } catch (err: any) {
    res.json({ ok: false, error: err.message, acceptances: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
  } finally {
    db.close();
  }
});

// GET /api/admin/legal-acceptances/:id/validate - Validate acceptance chain
router.get('/acceptances/:id/validate', async (req: Request, res: Response) => {
  const db = new BetterSQLite3('./trading_app.db');
  try {
    const acceptance = db.prepare('SELECT * FROM legal_acceptances WHERE id = ?').get(req.params.id) as any;
    if (!acceptance) return res.status(404).json({ ok: false, error: 'Acceptance not found' });
    
    // Verify ledger hash chain using the new schema
    const { sha256 } = require('../legal/cryptoUtils');
    const payload = [
      acceptance.ledger_seq,
      acceptance.prev_ledger_hash,
      acceptance.user_id,
      acceptance.email_at_acceptance,
      acceptance.country_iso2,
      acceptance.global_doc_id,
      acceptance.global_doc_version,
      acceptance.global_doc_sha256,
      acceptance.combined_sha256,
      acceptance.accepted_at,
    ].join('|');
    const expectedHash = sha256(payload);
    
    const valid = expectedHash === acceptance.ledger_hash;
    res.json({ ok: true, valid, expectedHash, actualHash: acceptance.ledger_hash });
  } catch (err: any) {
    res.json({ ok: false, error: err.message });
  } finally {
    db.close();
  }
});

// ==================== COVERAGE ====================

// GET /api/admin/legal-docs/coverage - Get coverage stats
router.get('/coverage/stats', async (req: Request, res: Response) => {
  try {
    const stats = getCoverageStats();
    res.json({
      ...stats,
      regions: Object.values(REGIONS),
    });
  } finally {}
});

// ==================== SYSTEM CONFIG ====================

// GET /api/admin/system-config/legal-enforcement - Get enforcement toggle
router.get('/system-config/enforcement', (req: Request, res: Response) => {
  res.json({ enforced: isEnforcementEnabled() });
});

// PATCH /api/admin/system-config/legal-enforcement - Set enforcement toggle
router.patch('/system-config/enforcement', (req: Request, res: Response) => {
  const { enforce } = req.body;
  if (typeof enforce !== 'boolean') return res.status(400).json({ error: 'enforce must be boolean' });
  setEnforcementEnabled(enforce);
  res.json({ success: true, enforced: enforce });
});

export default router;
