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

// Buffer for incomplete JSON chunks
let buffer = '';

/**
 * Extract the most meaningful value from a parsed telegram/device message.
 * Returns a human-readable string like "switch=on ch=1" or "dimValue=80" or "position=45".
 */
function extractSummary(obj) {
  // Try telegram-style: functions array
  const functions = obj.functions || (obj.state && obj.state.functions) || [];
  if (Array.isArray(functions) && functions.length > 0) {
    // Prefer non-channel entries as primary value
    const primary = functions.find(f => f.key && f.key !== 'channel' && f.value !== undefined);
    const channelEntry = functions.find(f => f.key === 'channel');
    // Also check direct channel field on function items (OPUS style: {key,value,channel})
    const channelFromPrimary = primary && primary.channel !== undefined ? primary.channel : undefined;
    const channel = channelFromPrimary !== undefined
      ? channelFromPrimary
      : (channelEntry ? channelEntry.value : undefined);

    if (primary) {
      const chStr = channel !== undefined ? ` ch=${channel}` : '';
      return `${primary.key}=${primary.value}${chStr}`;
    }
  }

  // Device state style: states array
  const states = obj.states;
  if (Array.isArray(states) && states.length > 0) {
    const s = states[0];
    const chStr = s.channel !== undefined ? ` ch=${s.channel}` : '';
    return `${s.key}=${s.value}${chStr}`;
  }

  return null;
}

/**
 * Try to parse and log one complete JSON object.
 * Returns true if parsed successfully.
 */
function tryParseAndLog(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);

    // Skip the large initial devices dump — just count it silently
    if (obj.header && obj.devices) {
      log('info', `Initial device list received (${(obj.devices || []).length} devices)`);
      return true;
    }

    const id = obj.deviceId || obj.id || null;
    const friendly = obj.friendlyId || null;
    const direction = obj.direction || null;
    const summary = extractSummary(obj);

    const uptime = Math.floor((Date.now() - startupTime) / 1000);

    // Only log device events that carry a meaningful live value (skip static device info sub-objects)
    if (summary && id) {
      const idStr = friendly ? `${friendly} (${id})` : id;
      const dirStr = direction ? ` [${direction}]` : '';
      log('info', `Processed ${messageCount} messages. Uptime: ${uptime}s | ${idStr}${dirStr} | ${summary}`);
    } else {
      log('info', `Processed ${messageCount} messages. Uptime: ${uptime}s`);
    }
    return true;
  } catch (e) {
    return false; // incomplete JSON — keep buffering
  }
}

function handleData(data) {
  try {
    mqttClient.publish(mqttTopic, data);
    messageCount++;
  } catch (e) {
    log('error', `Error publishing data: ${e.message}`);
  }

  // Buffer incoming data and attempt to parse complete JSON objects.
  // The OPUS stream sends pretty-printed JSON objects separated by whitespace/newlines.
  // HTTP chunks may split objects arbitrarily, so we accumulate until we have valid JSON.
  buffer += data;

  // Try to extract complete JSON objects from the buffer.
  // Strategy: find matching braces by scanning depth.
  let start = buffer.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let end = -1;
    for (let i = start; i < buffer.length; i++) {
      if (buffer[i] === '{') depth++;
      else if (buffer[i] === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }

    if (end === -1) break; // incomplete object — wait for more data

    const candidate = buffer.slice(start, end + 1);
    if (tryParseAndLog(candidate)) {
      buffer = buffer.slice(end + 1);
      start = buffer.indexOf('{');
    } else {
      // Malformed — skip past this opening brace and try next
      buffer = buffer.slice(start + 1);
      start = buffer.indexOf('{');
    }
  }

  // Prevent buffer from growing unbounded (e.g. garbled data)
  if (buffer.length > 1024 * 512) {
    log('warn', `Buffer overflow (${buffer.length} bytes), resetting`);
    buffer = '';
  }
}

function streamResponse(response) {
  response.on('data', (chunk) => {
    handleData(chunk.toString());
  });

  response.on('end', () => {
    log('info', `Stream ended, restarting in ${streamRestartTimeoutSec} seconds...`);
    buffer = '';
    setTimeout(initializeStream, streamRestartTimeoutSec * 1000);
  });

  response.on('error', (error) => {
    log('error', `Stream read error: ${error.message}`);
    log('info', `Restarting stream in ${streamRestartTimeoutSec} seconds...`);
    buffer = '';
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
