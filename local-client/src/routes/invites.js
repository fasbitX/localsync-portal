const express = require('express');
const { query } = require('../db');
const { sendBulkInvites } = require('../smtp');

const router = express.Router();

// POST /api/invites/send - Send gallery invites to contacts and/or groups
router.post('/invites/send', async (req, res) => {
  const { contactIds = [], groupIds = [], folderPath, galleryUrl } = req.body;

  if (!folderPath || !galleryUrl) {
    return res.status(400).json({ error: 'folderPath and galleryUrl are required' });
  }

  if (contactIds.length === 0 && groupIds.length === 0) {
    return res.status(400).json({ error: 'At least one contactId or groupId is required' });
  }

  try {
    // Resolve group memberships to contact IDs
    let groupContactIds = [];
    if (groupIds.length > 0) {
      const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(', ');
      const groupResult = await query(
        `SELECT DISTINCT contact_id FROM contact_group_members WHERE group_id IN (${placeholders})`,
        groupIds
      );
      groupContactIds = groupResult.rows.map((r) => r.contact_id);
    }

    // Merge and deduplicate contact IDs
    const allIds = [...new Set([...contactIds, ...groupContactIds])];

    if (allIds.length === 0) {
      return res.status(400).json({ error: 'No contacts found for the given IDs/groups' });
    }

    // Fetch contact details
    const idPlaceholders = allIds.map((_, i) => `$${i + 1}`).join(', ');
    const contactsResult = await query(
      `SELECT id, first_name, email FROM contacts WHERE id IN (${idPlaceholders})`,
      allIds
    );

    const contacts = contactsResult.rows;
    if (contacts.length === 0) {
      return res.status(404).json({ error: 'No valid contacts found' });
    }

    // Derive folder name from the path for the email subject
    const folderName = folderPath.split('/').filter(Boolean).pop() || folderPath;

    // Build recipient list
    const recipients = contacts.map((c) => ({
      email: c.email,
      firstName: c.first_name,
    }));

    // Send emails
    const emailResult = await sendBulkInvites(recipients, folderName, galleryUrl);

    // Record each invite in the database
    for (const contact of contacts) {
      const emailStatus = emailResult.results.find((r) => r.email === contact.email);
      const status = emailStatus && emailStatus.success ? 'sent' : 'failed';

      await query(
        `INSERT INTO invites (contact_id, email, folder_path, gallery_url, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [contact.id, contact.email, folderPath, galleryUrl, status]
      );
    }

    res.json({
      sent: emailResult.sent,
      failed: emailResult.failed,
      total: contacts.length,
    });
  } catch (err) {
    console.error('[invites] Send error:', err.message);
    res.status(500).json({ error: 'Failed to send invites' });
  }
});

// GET /api/invites - List invite history
router.get('/invites', async (req, res) => {
  try {
    const result = await query(
      `SELECT i.*, c.first_name, c.last_name
       FROM invites i
       LEFT JOIN contacts c ON c.id = i.contact_id
       ORDER BY i.sent_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[invites] GET error:', err.message);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

module.exports = router;
