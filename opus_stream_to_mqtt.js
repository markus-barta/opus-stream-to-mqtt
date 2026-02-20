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

// Log constructed URLs and options
// log('info', `Constructed streamUrl: ${streamUrl}`);
// log('info', `Constructed mqttBroker: ${mqttBroker}`);
// log('info', `Constructed mqttOptions: ${JSON.stringify(mqttOptions)}`);


const mqttClient = mqtt.connect(mqttBroker, mqttOptions);
let messageCount = 0;
let startupTime = Date.now();
const mqttTopic = process.env.MQTT_TOPIC || 'opus2mqtt/telegrams'; // Default to this if not set in .env


function handleData(data) {
  try {
    mqttClient.publish(mqttTopic, data);
    messageCount++;
  } catch (e) {
    log('error', `Error publishing data: ${e.message}`);
  }
  const uptime = Math.floor((Date.now() - startupTime) / 1000);
  log('info', `Processed ${messageCount} messages. Uptime: ${uptime} seconds.`);
}

function streamResponse(response) {
  response.on('data', (chunk) => {
    handleData(chunk.toString());
  });

  response.on('end', () => {
    log('info', `Stream ended, restarting in ${streamRestartTimeoutSec} seconds...`);
    setTimeout(initializeStream, streamRestartTimeoutSec * 1000);
  });

  response.on('error', (error) => {
    log('error', `Stream read error: ${error.message}`);
    log('info', `Restarting stream in ${streamRestartTimeoutSec} seconds...`);
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