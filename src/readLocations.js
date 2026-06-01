const READ_LOCATIONS = {
  inbox: {
    label: '收件箱',
    targets: [{ role: 'inbox', fallbackPath: 'INBOX' }],
    filterSelfSent: false,
  },
  all: {
    label: '全部邮件',
    targets: [{ role: 'all', fallbackPath: '[Gmail]/All Mail' }],
    filterSelfSent: true,
  },
  trash: {
    label: '垃圾箱',
    targets: [
      { role: 'junk', fallbackPath: '[Gmail]/Spam' },
      { role: 'trash', fallbackPath: '[Gmail]/Trash' },
    ],
    filterSelfSent: false,
  },
};

export function resolveReadLocation(readLocation = 'inbox') {
  const normalized = String(readLocation || 'inbox').trim().toLowerCase();
  const location = READ_LOCATIONS[normalized];
  if (!location) {
    throw new Error(`Invalid read location: ${readLocation}`);
  }
  return structuredClone(location);
}

export function normalizeFetchLimit(value, defaultLimit) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return defaultLimit;
  }
  return Math.min(parsed, 50);
}

export function isSelfSentMessage(message, gmailEmail) {
  const fromAddress = extractFromAddress(message);
  if (!fromAddress) {
    return false;
  }
  return fromAddress.toLowerCase() === String(gmailEmail || '').trim().toLowerCase();
}

function extractFromAddress(message) {
  if (message?.fromAddress) {
    return message.fromAddress;
  }
  if (typeof message?.from === 'string') {
    return message.from;
  }
  if (message?.from?.address) {
    return message.from.address;
  }
  if (Array.isArray(message?.from?.value) && message.from.value[0]?.address) {
    return message.from.value[0].address;
  }
  return null;
}
