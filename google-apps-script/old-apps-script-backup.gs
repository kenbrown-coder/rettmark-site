const CONFIG = {
  subscribersSheetName: 'Subscribers',
  unsubscribeLogSheetName: 'Unsubscribe Log',
  senderName: 'Rettmark Firearms',
  replyToEmail: 'info@rettmarkfirearms.com',
  senderAliasEmail: 'info@rettmarkfirearms.com',
  sourceLabel: 'Website'
};

function doPost(e) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    const payload = parseIncomingData_(e);
    const email = normalizeEmail_(payload.email);

    if (!email) {
      return HtmlService.createHtmlOutput('<h2>Missing email address.</h2>');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const subscribersSheet = ss.getSheetByName(CONFIG.subscribersSheetName);

    if (!subscribersSheet) {
      return HtmlService.createHtmlOutput('<h2>Subscribers sheet not found.</h2>');
    }

    const existingRow = findSubscriberRow_(subscribersSheet, email);
    const now = new Date();

    if (existingRow > 0) {
      const currentStatus = subscribersSheet.getRange(existingRow, 4).getValue();

      if (String(currentStatus).toLowerCase() === 'unsubscribed') {
        subscribersSheet.getRange(existingRow, 2).setValue(now);
        subscribersSheet.getRange(existingRow, 3).setValue(CONFIG.sourceLabel);
        subscribersSheet.getRange(existingRow, 4).setValue('Subscribed');
        subscribersSheet.getRange(existingRow, 5).clearContent();
        sendThankYouEmail_(email);
      }
    } else {
      subscribersSheet.appendRow([
        email,
        now,
        CONFIG.sourceLabel,
        'Subscribed',
        ''
      ]);

      sendThankYouEmail_(email);
    }

    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=https://rettmarkfirearms.com/success.html"></head><body></body></html>'
    );
  } catch (err) {
    return HtmlService.createHtmlOutput('<h2>Error: ' + err.message + '</h2>');
  }
}

function doGet(e) {
  try {
    const email = normalizeEmail_(e.parameter.email);

    if (!email) {
      return HtmlService.createHtmlOutput('<h2>Missing email address.</h2>');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const subscribersSheet = ss.getSheetByName(CONFIG.subscribersSheetName);
    const unsubscribeLogSheet = ss.getSheetByName(CONFIG.unsubscribeLogSheetName);

    if (!subscribersSheet || !unsubscribeLogSheet) {
      return HtmlService.createHtmlOutput('<h2>Required sheet not found.</h2>');
    }

    const row = findSubscriberRow_(subscribersSheet, email);
    const now = new Date();

    if (row > 0) {
      subscribersSheet.getRange(row, 4).setValue('Unsubscribed');
      subscribersSheet.getRange(row, 5).setValue(now);
    }

    unsubscribeLogSheet.appendRow([
      email,
      now,
      'One-click link',
      ''
    ]);

    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0; url=https://rettmarkfirearms.com/unsubscribe.html"></head><body></body></html>'
    );
  } catch (err) {
    return HtmlService.createHtmlOutput('<h2>Error: ' + err.message + '</h2>');
  }
}

function sendThankYouEmail_(email) {
  const subject = 'Welcome to Rettmark Firearms';

  const unsubscribeUrl =
    'https://script.google.com/macros/s/REDACTED_OLD_DEPLOYMENT/exec?email=' +
    encodeURIComponent(email);

  const htmlBody =
    '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #111111;">' +
      '<p style="margin: 0 0 16px 0;">Welcome to Rettmark Firearms.</p>' +
      '<p style="margin: 0 0 16px 0;">Thank you for your interest in our custom double-stack 1911 pistols.</p>' +
      '<p style="margin: 0 0 16px 0;">We’re pleased to have you with us at this early stage and appreciate your interest in what we’re building.</p>' +
      '<p style="margin: 0 0 16px 0;">As Rettmark continues to take shape, we’ll share updates on the brand, the website, and future pistol availability as information becomes available.</p>' +
      '<p style="margin: 0 0 16px 0;">If you have questions, simply reply to this email.</p>' +
      '<div style="margin-top: 24px;">' +
        '<p style="margin: 0 0 4px 0;"><strong>Ken Brown</strong></p>' +
        '<p style="margin: 0 0 4px 0;">Owner</p>' +
        '<p style="margin: 0;">Rettmark Firearms</p>' +
      '</div>' +
      '<p style="margin: 20px 0 0 0; font-size: 12px; color: #777777;">' +
        '<a href="' + unsubscribeUrl + '" style="color:#777777; text-decoration: underline;">Unsubscribe</a>' +
      '</p>' +
    '</div>';

  const plainBody =
    'Welcome to Rettmark Firearms.\n\n' +
    'Thank you for your interest in our custom double-stack 1911 pistols.\n\n' +
    'We’re pleased to have you with us at this early stage and appreciate your interest in what we’re building.\n\n' +
    'As Rettmark continues to take shape, we’ll share updates on the brand, the website, and future pistol availability as information becomes available.\n\n' +
    'If you have questions, simply reply to this email.\n\n' +
    'Ken Brown\n' +
    'Owner\n' +
    'Rettmark Firearms\n\n' +
    'Unsubscribe: ' + unsubscribeUrl;

  const options = {
    to: email,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: CONFIG.senderName,
    replyTo: CONFIG.replyToEmail
  };

  const aliases = GmailApp.getAliases();
  if (aliases.indexOf(CONFIG.senderAliasEmail) !== -1) {
    options.from = CONFIG.senderAliasEmail;
  }

  GmailApp.sendEmail(
    options.to,
    options.subject,
    options.body,
    options
  );
}

function parseIncomingData_(e) {
  if (!e) return {};

  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (jsonErr) {
      return parseFormEncoded_(e.postData.contents);
    }
  }

  return e.parameter || {};
}

function parseFormEncoded_(contents) {
  const obj = {};
  if (!contents) return obj;

  contents.split('&').forEach(function(pair) {
    const parts = pair.split('=');
    const key = decodeURIComponent((parts[0] || '').replace(/\+/g, ' '));
    const value = decodeURIComponent((parts[1] || '').replace(/\+/g, ' '));
    obj[key] = value;
  });

  return obj;
}

function normalizeEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function findSubscriberRow_(sheet, email) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < values.length; i++) {
    if (normalizeEmail_(values[i][0]) === email) {
      return i + 2;
    }
  }

  return -1;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
