(function attachMaterialFfmpegConverterAdapters(root) {
  'use strict';

  const LIMITS = Object.freeze({
    maxInputBytes: 32 * 1024 * 1024,
    maxOutputBytes: 48 * 1024 * 1024,
    maxSniffBytes: 64 * 1024,
    maxPreviewBytes: 4096,
    maxCsvRows: 100000,
    maxCsvColumns: 256,
    maxCellCharacters: 65536,
    maxJsonDepth: 64,
  });

  const CATEGORY_DEFINITIONS = [
    ['documents-pdf', 'Documents/PDF'],
    ['images', 'Images'],
    ['audio', 'Audio'],
    ['video', 'Video'],
    ['archives', 'Archives'],
    ['structured-data-spreadsheets', 'Structured Data/Spreadsheets'],
    ['code-text', 'Code/Text'],
    ['binary-encodings', 'Binary Encodings'],
  ];

  const categories = CATEGORY_DEFINITIONS.map(([id, label]) => ({ id, label }));

  const unavailable = (id, categoryId, label, sourceFormats, targetFormats, reason) => ({
    id,
    categoryId,
    label,
    sourceFormats,
    targetFormats,
    available: false,
    unavailableReason: reason,
    bundled: false,
    offline: true,
    lossiness: 'not-applicable',
    disclosure: reason,
  });

  const available = (definition) => ({
    ...definition,
    available: true,
    unavailableReason: null,
    bundled: true,
    offline: true,
  });

  const adapterDefinitions = [
    unavailable(
      'pdf-inspect',
      'documents-pdf',
      'Inspect PDF structure',
      ['application/pdf'],
      ['application/json'],
      'Unavailable in this browser build: no bounded offline PDF parser is bundled.'
    ),
    unavailable(
      'pdf-edit-pages',
      'documents-pdf',
      'Split, merge, extract, reorder, or rotate PDF pages',
      ['application/pdf'],
      ['application/pdf'],
      'Unavailable in this browser build: no bounded offline PDF writer and post-write validator are bundled.'
    ),
    unavailable(
      'pdf-edit-metadata',
      'documents-pdf',
      'Edit PDF metadata',
      ['application/pdf'],
      ['application/pdf'],
      'Unavailable in this browser build: no bounded offline PDF metadata writer and reopening validator are bundled.'
    ),
    unavailable(
      'image-transcode',
      'images',
      'Transcode images',
      ['image/*'],
      ['image/*'],
      'Unavailable in this browser build: a bounded isolated image decoder/encoder is not bundled.'
    ),
    unavailable(
      'audio-transcode',
      'audio',
      'Transcode audio',
      ['audio/*'],
      ['audio/*'],
      'Unavailable on the static site: FFmpeg runs only in the installed desktop application.'
    ),
    unavailable(
      'video-transcode',
      'video',
      'Transcode video',
      ['video/*'],
      ['video/*'],
      'Unavailable on the static site: FFmpeg runs only in the installed desktop application.'
    ),
    unavailable(
      'archive-pack-unpack',
      'archives',
      'Pack or unpack archives',
      ['application/zip', 'application/x-7z-compressed', 'application/gzip'],
      ['application/zip', 'application/x-7z-compressed'],
      'Unavailable in this browser build: no bounded archive adapter with path-traversal validation is bundled.'
    ),
    unavailable(
      'spreadsheet-xlsx',
      'structured-data-spreadsheets',
      'Read or write XLSX workbooks',
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['text/csv', 'application/json'],
      'Unavailable in this browser build: no bounded offline XLSX parser is bundled.'
    ),
    available({
      id: 'json-pretty',
      categoryId: 'structured-data-spreadsheets',
      label: 'Format JSON',
      sourceFormats: ['application/json'],
      targetFormats: ['application/json'],
      operation: 'json-pretty',
      lossiness: 'lossless-data',
      disclosure: 'Whitespace changes. JSON values and object member order are preserved.',
    }),
    available({
      id: 'json-minify',
      categoryId: 'structured-data-spreadsheets',
      label: 'Minify JSON',
      sourceFormats: ['application/json'],
      targetFormats: ['application/json'],
      operation: 'json-minify',
      lossiness: 'lossless-data',
      disclosure: 'Insignificant whitespace is removed. JSON values and object member order are preserved.',
    }),
    available({
      id: 'json-to-csv',
      categoryId: 'structured-data-spreadsheets',
      label: 'JSON records to CSV',
      sourceFormats: ['application/json'],
      targetFormats: ['text/csv'],
      operation: 'json-to-csv',
      lossiness: 'schema-limited',
      disclosure: 'Accepts a top-level array of flat objects. Nested values are serialized as compact JSON; missing fields become empty cells.',
    }),
    available({
      id: 'csv-to-json',
      categoryId: 'structured-data-spreadsheets',
      label: 'CSV to JSON records',
      sourceFormats: ['text/csv'],
      targetFormats: ['application/json'],
      operation: 'csv-to-json',
      lossiness: 'type-limited',
      disclosure: 'All CSV fields remain strings. Duplicate or empty header names are rejected instead of being silently overwritten.',
    }),
    available({
      id: 'normalize-text-lf',
      categoryId: 'code-text',
      label: 'Normalize UTF-8 text to LF',
      sourceFormats: ['text/plain'],
      targetFormats: ['text/plain'],
      operation: 'normalize-text-lf',
      lossiness: 'line-ending-change',
      disclosure: 'UTF-8 text is retained, a UTF-8 BOM is removed, and CRLF or CR line endings become LF.',
    }),
    available({
      id: 'binary-to-base64',
      categoryId: 'binary-encodings',
      label: 'Binary to Base64',
      sourceFormats: ['application/octet-stream', '*/*'],
      targetFormats: ['text/plain;base64'],
      operation: 'binary-to-base64',
      lossiness: 'lossless',
      disclosure: 'Bytes are encoded using the RFC 4648 Base64 alphabet with padding and no line wrapping.',
    }),
    available({
      id: 'base64-to-binary',
      categoryId: 'binary-encodings',
      label: 'Base64 to binary',
      sourceFormats: ['text/plain;base64', 'text/plain'],
      targetFormats: ['application/octet-stream'],
      operation: 'base64-to-binary',
      lossiness: 'lossless',
      disclosure: 'Only canonical RFC 4648 Base64 is accepted. Whitespace and URL-safe alphabet substitutions are rejected.',
    }),
    available({
      id: 'binary-to-hex',
      categoryId: 'binary-encodings',
      label: 'Binary to hexadecimal',
      sourceFormats: ['application/octet-stream', '*/*'],
      targetFormats: ['text/plain;hex'],
      operation: 'binary-to-hex',
      lossiness: 'lossless',
      disclosure: 'Each input byte becomes two lowercase hexadecimal characters with no separators.',
    }),
    available({
      id: 'hex-to-binary',
      categoryId: 'binary-encodings',
      label: 'Hexadecimal to binary',
      sourceFormats: ['text/plain;hex', 'text/plain'],
      targetFormats: ['application/octet-stream'],
      operation: 'hex-to-binary',
      lossiness: 'lossless',
      disclosure: 'Only an even number of ASCII hexadecimal characters is accepted. Whitespace and separators are rejected.',
    }),
  ];

  const operationById = new Map(adapterDefinitions.filter((item) => item.available).map((item) => [item.id, item.operation]));

  function converterError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function asBytes(value) {
    let bytes;
    if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else {
      throw converterError('INVALID_INPUT', 'Input must be an ArrayBuffer or typed-array view.');
    }
    if (bytes.byteLength > LIMITS.maxInputBytes) {
      throw converterError('INPUT_TOO_LARGE', `Input exceeds the ${LIMITS.maxInputBytes}-byte limit.`, {
        actualBytes: bytes.byteLength,
        maximumBytes: LIMITS.maxInputBytes,
      });
    }
    return bytes;
  }

  function startsWith(bytes, signature, offset = 0) {
    if (bytes.length < offset + signature.length) return false;
    return signature.every((value, index) => bytes[offset + index] === value);
  }

  function ascii(bytes, start, length) {
    let value = '';
    const end = Math.min(bytes.length, start + length);
    for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
    return value;
  }

  function decodeUtf8(bytes, label = 'input') {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
    } catch {
      throw converterError('INVALID_UTF8', `${label} is not valid UTF-8.`);
    }
  }

  function encodeUtf8(text) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > LIMITS.maxOutputBytes) {
      throw converterError('OUTPUT_TOO_LARGE', `Output exceeds the ${LIMITS.maxOutputBytes}-byte limit.`, {
        actualBytes: bytes.byteLength,
        maximumBytes: LIMITS.maxOutputBytes,
      });
    }
    return bytes;
  }

  function assertJsonDepth(value) {
    const stack = [{ value, depth: 1 }];
    while (stack.length) {
      const current = stack.pop();
      if (current.depth > LIMITS.maxJsonDepth) {
        throw converterError('JSON_TOO_DEEP', `JSON nesting exceeds the depth limit of ${LIMITS.maxJsonDepth}.`);
      }
      if (current.value && typeof current.value === 'object') {
        for (const child of Object.values(current.value)) {
          if (child && typeof child === 'object') stack.push({ value: child, depth: current.depth + 1 });
        }
      }
    }
  }

  function parseJson(bytes) {
    const text = decodeUtf8(bytes, 'JSON input');
    try {
      const value = JSON.parse(text);
      assertJsonDepth(value);
      return value;
    } catch (error) {
      if (error && error.code) throw error;
      throw converterError('INVALID_JSON', `JSON could not be parsed: ${error.message}`);
    }
  }

  function looksLikeText(bytes) {
    if (bytes.length === 0) return true;
    const sample = bytes.subarray(0, Math.min(bytes.length, LIMITS.maxSniffBytes));
    if (sample.includes(0)) return false;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return true;
    } catch {
      return false;
    }
  }

  function sniff(value, fileName = '') {
    const bytes = asBytes(value);
    const inspectedBytes = Math.min(bytes.length, LIMITS.maxSniffBytes);
    const extension = typeof fileName === 'string' && /\.([a-z0-9]{1,16})$/i.test(fileName)
      ? fileName.match(/\.([a-z0-9]{1,16})$/i)[1].toLowerCase()
      : null;
    let format = { id: 'binary', mime: 'application/octet-stream', confidence: 'fallback' };

    if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) format = { id: 'pdf', mime: 'application/pdf', confidence: 'signature' };
    else if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) format = { id: 'png', mime: 'image/png', confidence: 'signature' };
    else if (startsWith(bytes, [0xff, 0xd8, 0xff])) format = { id: 'jpeg', mime: 'image/jpeg', confidence: 'signature' };
    else if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') format = { id: 'gif', mime: 'image/gif', confidence: 'signature' };
    else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') format = { id: 'wav', mime: 'audio/wav', confidence: 'signature' };
    else if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp') format = { id: 'iso-bmff', mime: 'video/mp4', confidence: 'signature' };
    else if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) format = { id: 'webm-matroska', mime: 'video/webm', confidence: 'signature' };
    else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) format = { id: 'zip', mime: 'application/zip', confidence: 'signature' };
    else if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) format = { id: '7z', mime: 'application/x-7z-compressed', confidence: 'signature' };
    else if (startsWith(bytes, [0x1f, 0x8b])) format = { id: 'gzip', mime: 'application/gzip', confidence: 'signature' };
    else if (looksLikeText(bytes)) {
      const text = decodeUtf8(bytes.subarray(0, inspectedBytes));
      const trimmed = text.trimStart();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          JSON.parse(text);
          format = { id: 'json', mime: 'application/json', confidence: 'parsed' };
        } catch {
          format = { id: 'text', mime: 'text/plain', confidence: 'decoded' };
        }
      } else if ((extension === 'csv' || /[,;\t]/.test(text.split(/\r?\n/, 1)[0])) && /\r|\n/.test(text)) {
        format = { id: 'csv', mime: 'text/csv', confidence: extension === 'csv' ? 'signature-and-extension' : 'heuristic' };
      } else {
        format = { id: 'text', mime: 'text/plain', confidence: 'decoded' };
      }
    }

    return Object.freeze({
      ...format,
      bytes: bytes.byteLength,
      inspectedBytes,
      extensionHint: extension,
      extensionTrusted: false,
    });
  }

  async function checkpoint(context) {
    if (context && typeof context.checkpoint === 'function') await context.checkpoint();
  }

  function quoteCsvCell(value) {
    const text = value === null || value === undefined
      ? ''
      : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    if (text.length > LIMITS.maxCellCharacters) {
      throw converterError('CSV_CELL_TOO_LARGE', `A CSV cell exceeds the ${LIMITS.maxCellCharacters}-character limit.`);
    }
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  async function jsonToCsv(bytes, context) {
    const value = parseJson(bytes);
    if (!Array.isArray(value)) throw converterError('INVALID_JSON_RECORDS', 'JSON-to-CSV requires a top-level array.');
    if (value.length > LIMITS.maxCsvRows) throw converterError('CSV_ROW_LIMIT', `Record count exceeds ${LIMITS.maxCsvRows}.`);
    const headers = [];
    const seen = new Set();
    value.forEach((record) => {
      if (!record || Array.isArray(record) || typeof record !== 'object') {
        throw converterError('INVALID_JSON_RECORDS', 'Every JSON array item must be an object.');
      }
      Object.keys(record).forEach((key) => {
        if (!seen.has(key)) {
          if (headers.length >= LIMITS.maxCsvColumns) throw converterError('CSV_COLUMN_LIMIT', `Column count exceeds ${LIMITS.maxCsvColumns}.`);
          seen.add(key);
          headers.push(key);
        }
      });
    });
    const rows = [headers.map(quoteCsvCell).join(',')];
    for (let index = 0; index < value.length; index += 1) {
      if ((index & 255) === 0) await checkpoint(context);
      rows.push(headers.map((header) => quoteCsvCell(value[index][header])).join(','));
    }
    return encodeUtf8(`${rows.join('\r\n')}\r\n`);
  }

  async function parseCsv(text, context) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      if ((index & 16383) === 0) await checkpoint(context);
      const character = text[index];
      if (quoted) {
        if (character === '"') {
          if (text[index + 1] === '"') { cell += '"'; index += 1; }
          else quoted = false;
        } else {
          cell += character;
        }
      } else if (character === '"') {
        if (cell.length !== 0) throw converterError('INVALID_CSV', 'A quoted CSV field must begin at the start of a cell.');
        quoted = true;
      } else if (character === ',') {
        if (cell.length > LIMITS.maxCellCharacters) throw converterError('CSV_CELL_TOO_LARGE', `A CSV cell exceeds ${LIMITS.maxCellCharacters} characters.`);
        row.push(cell); cell = '';
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        row.push(cell); cell = '';
        if (row.length > LIMITS.maxCsvColumns) throw converterError('CSV_COLUMN_LIMIT', `Column count exceeds ${LIMITS.maxCsvColumns}.`);
        rows.push(row); row = [];
        if (rows.length > LIMITS.maxCsvRows + 1) throw converterError('CSV_ROW_LIMIT', `Row count exceeds ${LIMITS.maxCsvRows}.`);
      } else {
        cell += character;
      }
      if (cell.length > LIMITS.maxCellCharacters) throw converterError('CSV_CELL_TOO_LARGE', `A CSV cell exceeds ${LIMITS.maxCellCharacters} characters.`);
    }
    if (quoted) throw converterError('INVALID_CSV', 'CSV ends inside a quoted field.');
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  async function csvToJson(bytes, context) {
    const rows = await parseCsv(decodeUtf8(bytes, 'CSV input'), context);
    if (rows.length === 0) return encodeUtf8('[]\n');
    const headers = rows[0];
    if (headers.length === 0 || headers.some((header) => !header)) throw converterError('INVALID_CSV_HEADERS', 'CSV headers must be non-empty.');
    if (new Set(headers).size !== headers.length) throw converterError('INVALID_CSV_HEADERS', 'CSV headers must be unique.');
    const records = [];
    for (let index = 1; index < rows.length; index += 1) {
      if ((index & 255) === 0) await checkpoint(context);
      if (rows[index].length !== headers.length) {
        throw converterError('CSV_WIDTH_MISMATCH', `CSV row ${index + 1} has ${rows[index].length} cells; expected ${headers.length}.`);
      }
      const record = Object.create(null);
      headers.forEach((header, column) => { record[header] = rows[index][column]; });
      records.push(record);
    }
    return encodeUtf8(`${JSON.stringify(records, null, 2)}\n`);
  }

  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  async function binaryToBase64(bytes, context) {
    const predicted = Math.ceil(bytes.length / 3) * 4;
    if (predicted > LIMITS.maxOutputBytes) throw converterError('OUTPUT_TOO_LARGE', `Base64 output would exceed ${LIMITS.maxOutputBytes} bytes.`);
    const chunks = [];
    const chunkCharacters = 32768;
    let current = '';
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index];
      const hasB = index + 1 < bytes.length;
      const hasC = index + 2 < bytes.length;
      const b = hasB ? bytes[index + 1] : 0;
      const c = hasC ? bytes[index + 2] : 0;
      current += BASE64_ALPHABET[a >> 2];
      current += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
      current += hasB ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
      current += hasC ? BASE64_ALPHABET[c & 63] : '=';
      if (current.length >= chunkCharacters) { chunks.push(current); current = ''; await checkpoint(context); }
    }
    if (current) chunks.push(current);
    return encodeUtf8(chunks.join(''));
  }

  async function base64ToBinary(bytes, context) {
    const text = decodeUtf8(bytes, 'Base64 input');
    if (text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
      throw converterError('INVALID_BASE64', 'Input is not canonical padded RFC 4648 Base64.');
    }
    const padding = text.endsWith('==') ? 2 : (text.endsWith('=') ? 1 : 0);
    const outputLength = (text.length / 4) * 3 - padding;
    if (outputLength > LIMITS.maxOutputBytes) throw converterError('OUTPUT_TOO_LARGE', `Decoded output would exceed ${LIMITS.maxOutputBytes} bytes.`);
    const output = new Uint8Array(outputLength);
    let outputIndex = 0;
    for (let index = 0; index < text.length; index += 4) {
      const a = BASE64_ALPHABET.indexOf(text[index]);
      const b = BASE64_ALPHABET.indexOf(text[index + 1]);
      const c = text[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(text[index + 2]);
      const d = text[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(text[index + 3]);
      if (outputIndex < output.length) output[outputIndex++] = (a << 2) | (b >> 4);
      if (outputIndex < output.length) output[outputIndex++] = ((b & 15) << 4) | (c >> 2);
      if (outputIndex < output.length) output[outputIndex++] = ((c & 3) << 6) | d;
      if ((index & 65535) === 0) await checkpoint(context);
    }
    return output;
  }

  async function binaryToHex(bytes, context) {
    if (bytes.length * 2 > LIMITS.maxOutputBytes) throw converterError('OUTPUT_TOO_LARGE', `Hex output would exceed ${LIMITS.maxOutputBytes} bytes.`);
    const table = '0123456789abcdef';
    const chunks = [];
    let chunk = '';
    for (let index = 0; index < bytes.length; index += 1) {
      chunk += table[bytes[index] >> 4] + table[bytes[index] & 15];
      if (chunk.length >= 32768) { chunks.push(chunk); chunk = ''; await checkpoint(context); }
    }
    if (chunk) chunks.push(chunk);
    return encodeUtf8(chunks.join(''));
  }

  async function hexToBinary(bytes, context) {
    const text = decodeUtf8(bytes, 'Hex input');
    if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) throw converterError('INVALID_HEX', 'Hex input must contain an even number of ASCII hexadecimal characters and no separators.');
    const outputLength = text.length / 2;
    if (outputLength > LIMITS.maxOutputBytes) throw converterError('OUTPUT_TOO_LARGE', `Decoded output would exceed ${LIMITS.maxOutputBytes} bytes.`);
    const output = new Uint8Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      output[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
      if ((index & 32767) === 0) await checkpoint(context);
    }
    return output;
  }

  async function validateOutput(operation, output, context) {
    switch (operation) {
      case 'json-pretty':
      case 'json-minify':
      case 'csv-to-json':
        parseJson(output);
        return;
      case 'json-to-csv':
        await parseCsv(decodeUtf8(output, 'Generated CSV output'), context);
        return;
      case 'normalize-text-lf':
        decodeUtf8(output, 'Generated text output');
        return;
      case 'binary-to-base64': {
        const text = decodeUtf8(output, 'Generated Base64 output');
        if (text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
          throw converterError('OUTPUT_VALIDATION_FAILED', 'Generated Base64 output did not pass canonical validation.');
        }
        return;
      }
      case 'binary-to-hex':
        if (output.length % 2 !== 0 || !/^[0-9a-f]*$/.test(decodeUtf8(output, 'Generated hexadecimal output'))) {
          throw converterError('OUTPUT_VALIDATION_FAILED', 'Generated hexadecimal output did not pass validation.');
        }
        return;
      case 'base64-to-binary':
      case 'hex-to-binary':
        return;
      default:
        throw converterError('INTERNAL_ADAPTER_ERROR', `No output validator exists for ${operation}.`);
    }
  }

  async function convert(adapterId, value, options = {}, context = {}) {
    const bytes = asBytes(value);
    const operation = operationById.get(adapterId);
    if (!operation) {
      const definition = adapterDefinitions.find((item) => item.id === adapterId);
      if (definition && !definition.available) throw converterError('ADAPTER_UNAVAILABLE', definition.unavailableReason, { adapterId });
      throw converterError('UNKNOWN_ADAPTER', `Unknown converter adapter: ${String(adapterId)}`);
    }
    const optionKeys = Object.keys(options);
    if (optionKeys.length !== 0) {
      throw converterError('UNSUPPORTED_OPTIONS', `Adapter ${adapterId} does not accept conversion options.`, { optionKeys: optionKeys.sort() });
    }
    await checkpoint(context);
    let output;
    switch (operation) {
      case 'json-pretty': output = encodeUtf8(`${JSON.stringify(parseJson(bytes), null, 2)}\n`); break;
      case 'json-minify': output = encodeUtf8(JSON.stringify(parseJson(bytes))); break;
      case 'json-to-csv': output = await jsonToCsv(bytes, context); break;
      case 'csv-to-json': output = await csvToJson(bytes, context); break;
      case 'normalize-text-lf': output = encodeUtf8(decodeUtf8(bytes, 'Text input').replace(/\r\n?|\u2028|\u2029/g, '\n')); break;
      case 'binary-to-base64': output = await binaryToBase64(bytes, context); break;
      case 'base64-to-binary': output = await base64ToBinary(bytes, context); break;
      case 'binary-to-hex': output = await binaryToHex(bytes, context); break;
      case 'hex-to-binary': output = await hexToBinary(bytes, context); break;
      default: throw converterError('INTERNAL_ADAPTER_ERROR', `No conversion implementation exists for ${operation}.`);
    }
    await checkpoint(context);
    if (!(output instanceof Uint8Array)) throw converterError('INTERNAL_ADAPTER_ERROR', 'Converter did not return bytes.');
    if (output.byteLength > LIMITS.maxOutputBytes) throw converterError('OUTPUT_TOO_LARGE', `Output exceeds ${LIMITS.maxOutputBytes} bytes.`);
    await validateOutput(operation, output, context);
    const adapter = adapterDefinitions.find((item) => item.id === adapterId);
    return {
      bytes: output,
      metadata: {
        adapterId,
        sourceBytes: bytes.byteLength,
        outputBytes: output.byteLength,
        targetFormat: adapter.targetFormats[0],
        lossiness: adapter.lossiness,
        disclosure: adapter.disclosure,
        optionsApplied: [],
      },
    };
  }

  function inspect(value, fileName = '') {
    const bytes = asBytes(value);
    const detected = sniff(bytes, fileName);
    const candidateAdapters = adapterDefinitions
      .filter((adapter) => adapter.sourceFormats.includes('*/*') || adapter.sourceFormats.includes(detected.mime) || adapter.sourceFormats.includes(`${detected.mime};base64`) || adapter.sourceFormats.includes(`${detected.mime};hex`))
      .map((adapter) => ({ id: adapter.id, available: adapter.available, unavailableReason: adapter.unavailableReason }));
    const previewLength = Math.min(bytes.length, LIMITS.maxPreviewBytes);
    return {
      detected,
      candidateAdapters,
      preview: {
        inspectedBytes: previewLength,
        truncated: bytes.length > previewLength,
        utf8: looksLikeText(bytes.subarray(0, previewLength)) ? decodeUtf8(bytes.subarray(0, previewLength)) : null,
      },
    };
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return value;
    seen.add(value);
    Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key], seen));
    return Object.freeze(value);
  }

  const api = deepFreeze({
    version: 1,
    limits: LIMITS,
    categories,
    registry: adapterDefinitions,
    inspect,
    sniff,
    convert,
    asBytes,
  });

  Object.defineProperty(root, 'MaterialFFmpegConverterAdapters', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api,
  });
})(typeof self !== 'undefined' ? self : globalThis);
