'use strict';

importScripts('./converter-adapters.js');

const converter = self.MaterialFFmpegConverterAdapters;
const activeOperations = new Map();
const MESSAGE_VERSION = 1;
const MAX_OPERATION_ID_LENGTH = 128;

function send(payload, transfer = []) {
  self.postMessage({ version: MESSAGE_VERSION, ...payload }, transfer);
}

function validOperationId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_OPERATION_ID_LENGTH
    && /^[A-Za-z0-9._:-]+$/.test(value);
}

function serializeError(error) {
  return {
    code: error && typeof error.code === 'string' ? error.code : 'CONVERSION_FAILED',
    message: error && typeof error.message === 'string' ? error.message : 'The conversion failed.',
    details: error && error.details !== undefined ? error.details : null,
  };
}

function operationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function yieldToWorkerQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function checkpoint(operation) {
  await yieldToWorkerQueue();
  if (operation.cancelled) throw operationError('OPERATION_CANCELLED', 'The operation was cancelled before a result was committed.');
}

function beginOperation(id, action) {
  if (!validOperationId(id)) throw operationError('INVALID_OPERATION_ID', 'Operation id must be 1-128 characters using letters, numbers, dot, underscore, colon, or hyphen.');
  if (activeOperations.has(id)) throw operationError('DUPLICATE_OPERATION_ID', `Operation ${id} is already active.`);
  const operation = { id, action, cancelled: false, startedAt: Date.now() };
  activeOperations.set(id, operation);
  return operation;
}

function finishOperation(operation) {
  if (activeOperations.get(operation.id) === operation) activeOperations.delete(operation.id);
}

function cancelOperation(id) {
  if (!validOperationId(id)) {
    send({ id: typeof id === 'string' ? id : null, action: 'cancel', status: 'error', error: serializeError(operationError('INVALID_OPERATION_ID', 'A valid operation id is required.')) });
    return;
  }
  const operation = activeOperations.get(id);
  if (!operation) {
    send({ id, action: 'cancel', status: 'not-active' });
    return;
  }
  operation.cancelled = true;
  send({ id, action: 'cancel', status: 'cancellation-requested' });
}

async function inspectOperation(message) {
  let operation;
  try {
    operation = beginOperation(message.id, 'inspect');
    await checkpoint(operation);
    const result = converter.inspect(message.input, typeof message.fileName === 'string' ? message.fileName : '');
    await checkpoint(operation);
    send({
      id: operation.id,
      action: 'inspect',
      status: 'complete',
      elapsedMs: Date.now() - operation.startedAt,
      result,
    });
  } catch (error) {
    send({
      id: message && validOperationId(message.id) ? message.id : null,
      action: 'inspect',
      status: error && error.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'error',
      error: serializeError(error),
    });
  } finally {
    if (operation) finishOperation(operation);
  }
}

async function convertOperation(message) {
  let operation;
  try {
    operation = beginOperation(message.id, 'convert');
    if (typeof message.adapterId !== 'string' || message.adapterId.length > 128) {
      throw operationError('INVALID_ADAPTER_ID', 'A bounded adapter id is required.');
    }
    const options = message.options && typeof message.options === 'object' && !Array.isArray(message.options)
      ? message.options
      : {};
    const result = await converter.convert(message.adapterId, message.input, options, {
      checkpoint: () => checkpoint(operation),
    });
    await checkpoint(operation);

    // The success message is emitted once, only after the full output exists and
    // every adapter-level validation has completed. No partial output is posted.
    const outputBuffer = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength);
    send({
      id: operation.id,
      action: 'convert',
      status: 'complete',
      elapsedMs: Date.now() - operation.startedAt,
      result: {
        output: outputBuffer,
        metadata: result.metadata,
      },
    }, [outputBuffer]);
  } catch (error) {
    send({
      id: message && validOperationId(message.id) ? message.id : null,
      action: 'convert',
      status: error && error.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'error',
      error: serializeError(error),
    });
  } finally {
    if (operation) finishOperation(operation);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    send({ id: null, action: null, status: 'error', error: serializeError(operationError('INVALID_MESSAGE', 'Worker messages must be objects.')) });
    return;
  }
  if (message.version !== MESSAGE_VERSION) {
    send({ id: validOperationId(message.id) ? message.id : null, action: message.action || null, status: 'error', error: serializeError(operationError('UNSUPPORTED_VERSION', `Worker protocol version ${MESSAGE_VERSION} is required.`)) });
    return;
  }
  if (message.action === 'cancel') {
    cancelOperation(message.id);
  } else if (message.action === 'inspect') {
    void inspectOperation(message);
  } else if (message.action === 'convert') {
    void convertOperation(message);
  } else if (message.action === 'registry') {
    send({
      id: validOperationId(message.id) ? message.id : null,
      action: 'registry',
      status: 'complete',
      result: {
        version: converter.version,
        limits: converter.limits,
        categories: converter.categories,
        registry: converter.registry,
      },
    });
  } else {
    send({ id: validOperationId(message.id) ? message.id : null, action: message.action || null, status: 'error', error: serializeError(operationError('UNKNOWN_ACTION', 'Supported actions are registry, inspect, convert, and cancel.')) });
  }
});

send({
  id: null,
  action: 'ready',
  status: 'complete',
  result: {
    protocolVersion: MESSAGE_VERSION,
    registryVersion: converter.version,
    limits: converter.limits,
  },
});
