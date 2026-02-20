require('dotenv').config();
const fetch = require('node-fetch');
const mqtt = require('mqtt');

function log(level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
}

const streamRestartTimeoutSec = 3;
const streamErrorRestartTimeoutSec = 10;
const streamUrl = `http://${process.env.STREAM_USER}:${process.env.STREAM_PASS}@${process.env.STREAM_IP}:${process.env.STREAM_PORT}/devices/stream?direction=both`;
const mqttBroker = process.env.MQTT_BROKER;
const mqttOptions = {
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS
};

const mqttClient = mqtt.connect(mqttBroker, mqttOptions);
let messageCount = 0;
let startupTime = Date.now();
const mqttTopic = process.env.MQTT_TOPIC || 'opus2mqtt/telegrams';

// Buffer for accumulating chunks until we have a complete top-level JSON object.
// The OPUS gateway sends pretty-printed JSON over chunked HTTP. Each top-level
// object (initial device list, then individual telegrams) may span multiple chunks.
// We track brace depth at the TOP level only to find object boundaries.
let buffer = '';
let depth = 0;
let inString = false;
let escape = false;

/**
 * Extract the most meaningful value from a parsed telegram/device message.
 * Returns a human-readable string like "switch=on ch=1" or "dimValue=80".
 */
function extractSummary(obj) {
  const functions = obj.functions || (obj.state && obj.state.functions) || [];
  if (Array.isArray(functions) && functions.length > 0) {
    const primary = functions.find(f => f.key && f.key !== 'channel' && f.value !== undefined);
    const channelEntry = functions.find(f => f.key === 'channel');
    const channelFromPrimary = primary && primary.channel !== undefined ? primary.channel : undefined;
    const channel = channelFromPrimary !== undefined
      ? channelFromPrimary
      : (channelEntry ? channelEntry.value : undefined);

    if (primary) {
      const chStr = channel !== undefined ? ` ch=${channel}` : '';
      return `${primary.key}=${primary.value}${chStr}`;
    }
  }

  const states = obj.states;
  if (Array.isArray(states) && states.length > 0) {
    const s = states[0];
    const chStr = s.channel !== undefined ? ` ch=${s.channel}` : '';
    return `${s.key}=${s.value}${chStr}`;
  }

  return null;
}

/**
 * Process a complete top-level JSON object from the stream.
 */
function processComplete(jsonStr) {
  let obj;
  try {
    obj = JSON.parse(jsonStr);
  } catch (e) {
    log('warn', `Failed to parse JSON (${jsonStr.length} bytes): ${e.message}`);
    return;
  }

  // Publish raw data to MQTT
  try {
    mqttClient.publish(mqttTopic, jsonStr);
    messageCount++;
  } catch (e) {
    log('error', `Error publishing data: ${e.message}`);
  }

  const uptime = Math.floor((Date.now() - startupTime) / 1000);

  // Initial device list
  if (obj.header && obj.devices) {
    log('info', `Initial device list received (${obj.devices.length} devices). Uptime: ${uptime}s`);
    return;
  }

  // Live telegram / device event — data is nested under obj.telegram
  const telegram = obj.telegram || obj;
  const id = telegram.deviceId || null;
  const friendly = telegram.friendlyId || null;
  const direction = telegram.direction || null;
  const summary = extractSummary(telegram);

  if (id) {
    const idStr = friendly ? `${friendly} (${id})` : id;
    const dirStr = direction ? ` [${direction}]` : '';
    const sumStr = summary ? ` | ${summary}` : '';
    log('info', `#${messageCount} Uptime: ${uptime}s | ${idStr}${dirStr}${sumStr}`);
  } else {
    log('info', `#${messageCount} Uptime: ${uptime}s`);
  }
}

function handleData(data) {
  // Feed each character through a state machine that tracks top-level brace depth.
  // When depth returns to 0 after being >0, we have a complete top-level JSON object.
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];

    if (escape) {
      escape = false;
      buffer += ch;
      continue;
    }

    if (inString) {
      if (ch === '\\') { escape = true; }
      else if (ch === '"') { inString = false; }
      buffer += ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      buffer += ch;
      continue;
    }

    if (ch === '{') {
      depth++;
      buffer += ch;
    } else if (ch === '}') {
      depth--;
      buffer += ch;
      if (depth === 0 && buffer.length > 0) {
        processComplete(buffer.trim());
        buffer = '';
      }
    } else if (depth > 0) {
      buffer += ch;
    }
    // Characters outside braces (whitespace between objects) are ignored
  }

  // Guard against buffer growing unbounded
  if (buffer.length > 2 * 1024 * 1024) {
    log('warn', `Buffer overflow (${buffer.length} bytes), resetting`);
    buffer = '';
    depth = 0;
    inString = false;
    escape = false;
  }
}

function streamResponse(response) {
  response.on('data', (chunk) => {
    handleData(chunk.toString());
  });

  response.on('end', () => {
    log('info', `Stream ended, restarting in ${streamRestartTimeoutSec} seconds...`);
    buffer = '';
    depth = 0;
    inString = false;
    escape = false;
    setTimeout(initializeStream, streamRestartTimeoutSec * 1000);
  });

  response.on('error', (error) => {
    log('error', `Stream read error: ${error.message}`);
    log('info', `Restarting stream in ${streamRestartTimeoutSec} seconds...`);
    buffer = '';
    depth = 0;
    inString = false;
    escape = false;
    setTimeout(initializeStream, streamRestartTimeoutSec * 1000);
  });
}

function initializeStream() {
  log('info', 'Initializing stream...');

  fetch(streamUrl, {
    method: 'GET',
    headers: {
      'Accept-Encoding': 'identity'
    }
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
    return streamResponse(response.body);
  })
  .catch(error => {
    log('error', `Stream error: ${error.message}`);
    log('info', `Retrying in ${streamErrorRestartTimeoutSec} seconds...`);
    setTimeout(initializeStream, streamErrorRestartTimeoutSec * 1000);
  });
}

mqttClient.on('connect', () => {
  log('info', 'Connected to MQTT broker');
});

mqttClient.on('error', (error) => {
  log('error', `MQTT error: ${error.message}`);
});

log('info', 'Opus stream to MQTT service started');
initializeStream();
