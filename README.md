# OPUS Stream to MQTT Bridge

This simple Node.js service connects to an OPUS Gateway device stream API and publishes all received audio/playback events directly to an MQTT broker.

## How it works

The service opens an HTTP GET request to the OPUS gateway's `/devices/stream?direction=both` endpoint using HTTP Basic Authentication. It listens to the `chunk` events on the response body and forwards the raw data payloads to the configured MQTT topic.

If the stream disconnects or errors out, the service automatically attempts to reconnect.

## Environment Variables

The service is configured entirely via environment variables (e.g. using a `.env` file):

| Variable      | Required | Description                                                         |
| ------------- | -------- | ------------------------------------------------------------------- |
| `STREAM_USER` | Yes      | Username for the OPUS Gateway basic auth                            |
| `STREAM_PASS` | Yes      | Password for the OPUS Gateway basic auth                            |
| `STREAM_IP`   | Yes      | IP address of the OPUS Gateway                                      |
| `STREAM_PORT` | Yes      | Port of the OPUS Gateway (typically 80 or 8080)                     |
| `MQTT_BROKER` | Yes      | Full URI to your MQTT broker (e.g., `mqtt://192.168.1.101:1883`) |
| `MQTT_TOPIC`  | No       | Topic to publish to (defaults to `opus2mqtt/telegrams`)             |
| `MQTT_USER`   | No       | Username for MQTT authentication (leave empty for none)             |
| `MQTT_PASS`   | No       | Password for MQTT authentication (leave empty for none)             |

## Running locally

```bash
cp .env.example .env
# Edit .env with your credentials
npm install
npm start
```

## Running via Docker Compose (Recommended)

This service is so small it can be built on-the-fly using a generic Node alpine image. This avoids the need to build and host custom OCI images.

```yaml
services:
  opus-stream-to-mqtt:
    image: node:alpine
    container_name: opus-stream-to-mqtt
    network_mode: host
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./:/app
    working_dir: /app
    command: sh -c "npm install && npm ci && npm start"
```
