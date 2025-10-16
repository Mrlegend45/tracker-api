const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('querystring');

const POST_URL = 'https://freshsimdata.net/numberDetails.php';
const COOKIE_HEADER = process.env.FRESHSIM_COOKIES || '';

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
  'Referer': 'https://freshsimdata.net/'
};

function parseTableHtml(html) {
  const $ = cheerio.load(html);
  let targetTable = null;

  $('table').each((i, el) => {
    const headerText = $(el).find('thead').text() || $(el).find('tr').first().text();
    if (/Mobile|Name|CNIC/i.test(headerText)) {
      targetTable = el;
      return false;
    }
  });

  if (!targetTable) return [];

  const rows = $(targetTable).find('tbody tr');
  const result = [];

  rows.each((i, r) => {
    const cols = $(r).find('td, th');
    if (cols.length === 0) return;

    const colText = [];
    cols.each((j, c) => colText.push($(c).text().trim()));

    result.push({
      Mobile: colText[0] || null,
      Name: colText[1] || null,
      CNIC: colText[2] || null,
      Address: colText[3] || null,
      Country: 'Pakistan'
    });
  });

  return result;
}

async function fetchRecords(value) {
  const payload = qs.stringify({
    numberCnic: value,
    searchNumber: 'search'
  });

  const headers = Object.assign({}, DEFAULT_HEADERS, COOKIE_HEADER ? { Cookie: COOKIE_HEADER } : {});
  const response = await axios.post(POST_URL, payload, { headers, timeout: 20000, responseType: 'text' });
  return parseTableHtml(response.data);
}

module.exports = async function (req, res) {
  const phone = (req.query && req.query.phone) ? req.query.phone.toString().trim() :
                (req.body && req.body.phone) ? req.body.phone.toString().trim() : '';

  if (!phone) {
    return res.status(400).json({ error: 'phone parameter required. Example: /api/track?phone=03027665767' });
  }

  try {
    const phoneRecords = await fetchRecords(phone);
    if (phoneRecords.length === 0) {
      return res.json({ success: true, phone, records: [] });
    }

    const cnic = phoneRecords[0].CNIC;
    const cnicRecords = cnic ? await fetchRecords(cnic) : [];

    const allRecords = [...phoneRecords, ...cnicRecords];
    const unique = [];
    const seen = new Set();

    for (const rec of allRecords) {
      const key = `${rec.Mobile}-${rec.CNIC}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rec);
      }
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.json({
      success: true,
      phone,
      records: unique
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      error: 'Request failed',
      details: err.message,
      statusCode: err.response ? err.response.status : null
    });
  }
};
