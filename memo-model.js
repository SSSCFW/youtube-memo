(function (root) {
  'use strict';

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isId(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function isTime(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function nextId(reservedIds) {
    let number = 1;
    while (reservedIds.has(`page-${number}`)) number += 1;
    const id = `page-${number}`;
    reservedIds.add(id);
    return id;
  }

  function createPage(pages) {
    const reservedIds = new Set(
      (Array.isArray(pages) ? pages : [])
        .filter((page) => isRecord(page) && isId(page.id))
        .map((page) => page.id)
    );
    return { id: nextId(reservedIds), title: '', content: '', startTime: null };
  }

  function normalizeMemo(saved, legacyContent = '') {
    if (typeof saved === 'string') {
      legacyContent = saved;
      saved = null;
    }
    const record = isRecord(saved) ? saved : {};
    const sourcePages = Array.isArray(record.pages) ? record.pages.filter(isRecord) : [];
    // Reserve every valid ID first so a repaired entry cannot steal a later ID.
    const reservedIds = new Set(sourcePages.filter((page) => isId(page.id)).map((page) => page.id));
    const usedIds = new Set();
    const pages = sourcePages.map((page) => {
      const id = isId(page.id) && !usedIds.has(page.id) ? page.id : nextId(reservedIds);
      usedIds.add(id);
      return {
        id,
        title: typeof page.title === 'string' ? page.title : '',
        content: typeof page.content === 'string' ? page.content : '',
        startTime: isTime(page.startTime) ? page.startTime : null,
      };
    });

    if (pages.length === 0) {
      pages.push({
        id: 'page-1',
        title: '',
        content: typeof legacyContent === 'string' ? legacyContent : '',
        startTime: 0,
      });
    }

    return {
      version: 1,
      pages,
      activePageId: pages.some((page) => page.id === record.activePageId) ? record.activePageId : pages[0].id,
      autoSwitch: record.autoSwitch === true,
    };
  }

  function getPageAtTime(pages, seconds) {
    if (!Array.isArray(pages) || !isTime(seconds)) return null;
    const validPages = pages.filter((page) => isRecord(page) && isId(page.id));
    if (validPages.length === 0) return null;

    let selectedId = validPages[0].id;
    let selectedTime = -Infinity;
    for (const page of validPages) {
      if (isTime(page.startTime) && page.startTime <= seconds && page.startTime >= selectedTime) {
        selectedId = page.id;
        selectedTime = page.startTime;
      }
    }
    return selectedId;
  }

  function parseTime(text) {
    if (typeof text !== 'string') return null;
    const parts = text.trim().split(':');
    if (parts.length > 3) return null;
    const lastIndex = parts.length - 1;
    if (!/^\d+(?:\.\d+)?$/.test(parts[lastIndex])) return null;
    if (parts.slice(0, lastIndex).some((part) => !/^\d+$/.test(part))) return null;

    const values = parts.map(Number);
    if (values.slice(1).some((value) => value >= 60)) return null;
    const seconds = values.reduce((total, value) => total * 60 + value, 0);
    return isTime(seconds) ? seconds : null;
  }

  // Expand Number's exponential notation without rounding away fractional cues.
  function decimalText(seconds) {
    const [coefficient, exponent] = String(seconds).split('e');
    if (exponent === undefined) return coefficient;
    const [integer, fraction = ''] = coefficient.split('.');
    const digits = integer + fraction;
    const decimalIndex = integer.length + Number(exponent);
    if (decimalIndex <= 0) return `0.${'0'.repeat(-decimalIndex)}${digits}`;
    if (decimalIndex >= digits.length) return digits + '0'.repeat(decimalIndex - digits.length);
    return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  }

  function formatTime(seconds) {
    if (!isTime(seconds)) return '';
    const [integer, fraction] = decimalText(seconds).split('.');
    const wholeSeconds = BigInt(integer);
    const hours = wholeSeconds / 3600n;
    const minutes = (wholeSeconds / 60n) % 60n;
    const remainder = String(wholeSeconds % 60n).padStart(2, '0');
    const secondsText = remainder + (fraction ? `.${fraction}` : '');
    return hours > 0n
      ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
      : `${minutes}:${secondsText}`;
  }

  const model = { normalizeMemo, createPage, getPageAtTime, parseTime, formatTime };

  root.YouTubeMemoModel = model;
  if (typeof module === 'object' && module.exports) module.exports = model;
})(globalThis);
