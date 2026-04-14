const express = require('express');
const { query } = require('../db');

const router = express.Router();

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

// GET /api/contacts - List all contacts
router.get('/contacts', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM contacts ORDER BY last_name, first_name'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[contacts] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts - Create a contact
router.post('/contacts', async (req, res) => {
  const { firstName, lastName, email, phone, notes } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required' });
  }

  try {
    const result = await query(
      `INSERT INTO contacts (first_name, last_name, email, phone, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [firstName, lastName, email, phone || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with that email already exists' });
    }
    console.error('[contacts] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// PUT /api/contacts/:id - Update a contact
router.put('/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { firstName, lastName, email, phone, notes } = req.body;

  if (!firstName || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required' });
  }

  try {
    const result = await query(
      `UPDATE contacts
       SET first_name = $1, last_name = $2, email = $3, phone = $4, notes = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [firstName, lastName, email, phone || null, notes || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with that email already exists' });
    }
    console.error('[contacts] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:id - Delete a contact
router.delete('/contacts/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      'DELETE FROM contacts WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json({ deleted: true, id: parseInt(id, 10) });
  } catch (err) {
    console.error('[contacts] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

// GET /api/groups - List groups with member counts
router.get('/groups', async (req, res) => {
  try {
    const result = await query(
      `SELECT g.*, COALESCE(m.member_count, 0)::int AS member_count
       FROM contact_groups g
       LEFT JOIN (
         SELECT group_id, COUNT(*) AS member_count
         FROM contact_group_members
         GROUP BY group_id
       ) m ON m.group_id = g.id
       ORDER BY g.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// POST /api/groups - Create a group
router.post('/groups', async (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const result = await query(
      `INSERT INTO contact_groups (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [name, description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[groups] POST error:', err.message);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// PUT /api/groups/:id - Update a group
router.put('/groups/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const result = await query(
      `UPDATE contact_groups SET name = $1, description = $2 WHERE id = $3 RETURNING *`,
      [name, description || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[groups] PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// DELETE /api/groups/:id - Delete a group
router.delete('/groups/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      'DELETE FROM contact_groups WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ deleted: true, id: parseInt(id, 10) });
  } catch (err) {
    console.error('[groups] DELETE error:', err.message);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// GET /api/groups/:id/members - List members in a group
router.get('/groups/:id/members', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await query(
      `SELECT c.*
       FROM contacts c
       INNER JOIN contact_group_members cgm ON cgm.contact_id = c.id
       WHERE cgm.group_id = $1
       ORDER BY c.last_name, c.first_name`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups] GET members error:', err.message);
    res.status(500).json({ error: 'Failed to fetch group members' });
  }
});

// POST /api/groups/:id/members - Add a member to a group
router.post('/groups/:id/members', async (req, res) => {
  const { id } = req.params;
  const { contactId } = req.body;

  if (!contactId) {
    return res.status(400).json({ error: 'contactId is required' });
  }

  try {
    await query(
      `INSERT INTO contact_group_members (group_id, contact_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id, contactId]
    );
    res.status(201).json({ groupId: parseInt(id, 10), contactId: parseInt(contactId, 10) });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Group or contact not found' });
    }
    console.error('[groups] POST member error:', err.message);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// DELETE /api/groups/:id/members/:contactId - Remove a member from a group
router.delete('/groups/:id/members/:contactId', async (req, res) => {
  const { id, contactId } = req.params;

  try {
    const result = await query(
      `DELETE FROM contact_group_members
       WHERE group_id = $1 AND contact_id = $2
       RETURNING group_id`,
      [id, contactId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Membership not found' });
    }

    res.json({ deleted: true, groupId: parseInt(id, 10), contactId: parseInt(contactId, 10) });
  } catch (err) {
    console.error('[groups] DELETE member error:', err.message);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

module.exports = router;
