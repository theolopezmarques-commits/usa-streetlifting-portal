const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { dbGet } = require('../db');

const router = express.Router();

const TEMPLATE_PATH = path.join(__dirname, '../public/Achievement Certificate.png');

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDate(d) {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

const HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
}

async function generateCertificate(userName, level, grantedAt) {
  const issueDate  = new Date(grantedAt);
  const validUntil = new Date(grantedAt);
  validUntil.setFullYear(validUntil.getFullYear() + 1);

  const bgBase64 = fs.readFileSync(TEMPLATE_PATH).toString('base64');
  const bgSrc = `data:image/png;base64,${bgBase64}`;

  const levelNames = {
    0: 'Entry Judge',
    1: 'Local Judge',
    2: 'State Judge',
    3: 'National Judge',
  };

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1122px;
    height: 794px;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .bg {
    position: absolute;
    top: 0; left: 0;
    width: 1122px;
    height: 794px;
  }
  .content {
    position: absolute;
    top: 0; left: 0;
    width: 1122px;
    height: 794px;
  }
  /* Date of issue — value right after the colon on the same line */
  .date-issue {
    position: absolute;
    top: 108px;
    left: 205px;
    font-size: 11.5px;
    color: #333;
    font-family: Arial, sans-serif;
  }
  /* Valid until — value right after the colon */
  .date-valid {
    position: absolute;
    top: 130px;
    left: 187px;
    font-size: 11.5px;
    color: #333;
    font-family: Arial, sans-serif;
  }
  /* Level number — right after LEVEL word, same size */
  .level-number {
    position: absolute;
    top: 267px;
    left: 584px;
    font-size: 30px;
    font-weight: bold;
    color: #132E84;
    font-family: Arial, sans-serif;
  }
  /* Name — centered, above the underline */
  .name {
    position: absolute;
    top: 348px;
    left: 0;
    width: 1122px;
    text-align: center;
    font-size: 36px;
    font-weight: bold;
    color: #132E84;
    font-family: Arial, sans-serif;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <img class="bg" src="${bgSrc}">
  <div class="content">
    <div class="date-issue">${escapeHtml(formatDate(issueDate))}</div>
    <div class="date-valid">${escapeHtml(formatDate(validUntil))}</div>
    <div class="level-number">${escapeHtml(level)}</div>
    <div class="name">${escapeHtml(userName.toUpperCase())}</div>
  </div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    // Defense in depth: even if escaping above were ever bypassed, refuse to let the
    // server-side browser reach the network. The template only needs the inline
    // data: background image, so every other request is aborted.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('data:')) {
        req.continue();
      } else {
        req.abort();
      }
    });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      width:  '1122px',
      height: '794px',
      printBackground: true,
      pageRanges: '1',
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

// GET /api/certificate/:level?as_user=ID
router.get('/:level', async (req, res) => {
  const level = parseInt(req.params.level);
  const adminUser = dbGet('SELECT is_admin FROM users WHERE id = ?', [req.user.id]);
  const userId = (adminUser?.is_admin && req.query.as_user)
    ? parseInt(req.query.as_user)
    : req.user.id;

  if (![0, 1, 2, 3].includes(level)) {
    return res.status(400).json({ error: 'Invalid level.' });
  }

  const cert = dbGet(
    `SELECT granted_at FROM certifications WHERE user_id = ? AND level = ?`,
    [userId, level]
  );
  if (!cert) {
    return res.status(403).json({ error: 'No certification granted yet for this level.' });
  }

  const user = dbGet('SELECT name FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  try {
    const pdfBytes = await generateCertificate(user.name, level, cert.granted_at);
    res.setHeader('Content-Type', 'application/pdf');
    // Node rejects non-latin1 header values, and a bare `"` would break the quoted
    // filename, so the ASCII `filename` is a sanitised, safe-charset-only fallback
    // and the real name (any charset) travels in the RFC 5987 `filename*` param.
    const underscored = user.name.replace(/\s+/g, '_');
    const asciiName = underscored.replace(/[^A-Za-z0-9_-]/g, '');
    const fallbackName = `USASL_Level${level}_Certificate${asciiName ? '_' + asciiName : ''}.pdf`;
    const utf8Name = encodeURIComponent(`USASL_Level${level}_Certificate_${underscored}.pdf`);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallbackName}"; filename*=UTF-8''${utf8Name}`
    );
    res.end(pdfBytes);
  } catch (err) {
    console.error('Certificate generation error:', err.message);
    res.status(500).json({ error: 'Could not generate certificate.' });
  }
});

module.exports = router;
