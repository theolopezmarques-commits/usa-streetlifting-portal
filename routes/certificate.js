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
    <div class="date-issue">${formatDate(issueDate)}</div>
    <div class="date-valid">${formatDate(validUntil)}</div>
    <div class="level-number">${level}</div>
    <div class="name">${userName.toUpperCase()}</div>
  </div>
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
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
    res.setHeader('Content-Disposition', `attachment; filename="USASL_Level${level}_Certificate_${user.name.replace(/\s+/g, '_')}.pdf"`);
    res.end(pdfBytes);
  } catch (err) {
    console.error('Certificate generation error:', err.message);
    res.status(500).json({ error: 'Could not generate certificate.' });
  }
});

module.exports = router;
