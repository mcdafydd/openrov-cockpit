function telemetry(name, deps) {

  const mqtt       = require('mqtt');
  const mqttUri    = 'ws://127.0.0.1:3000';
  let mqttConnected = false;

  deps.logger.debug('This is where Telemetry code would execute in the node process.');
  var statusdata = {};
  deps.globalEventLoop.on('mcu.status', function (data) {
    for (var i in data) {
      if (i === 'cmd') {
        //filter out ping command echos
        if (data[i].indexOf('ping') >= 0) {
          continue;
        }
      }
      if (i === 'depth_p' || i === 'depth_t' || i === 'depth_d'
          || i === 'imu_r' || i === 'imu_p' || i === 'imu_y')
      {
        statusdata[i] = data[i] * 0.001;
      }
      else
        statusdata[i] = data[i];
    }
  });
  setInterval(function () {
    deps.cockpit.emit('plugin.telemetry.logData', statusdata);
    // SCINI - publish telmetry to view-only browser clients
    client.publish('telemetry/update', JSON.stringify(statusdata));
  }, 1000);

  // Connect to MQTT broker and setup all event handlers
  // This is used to publish camera settings to camera viewers for controls
  const client = mqtt.connect(mqttUri, {
    protocolVersion: 4,
    resubscribe: true,
    clientId: 'telemetry',
    keepalive: 15,
    will: {
        topic: 'status/openrov',
        payload: 'TELEMETRY: OpenROV MQTT client disconnected!',
        qos: 0,
        retain: false
    }
  });

  client.on('connect', () => {
    mqttConnected = true;
    deps.logger.debug('TELEMETRY: MQTT broker connection established!');
  });

  client.on('reconnect', () => {
    mqttConnected = true;
    deps.logger.debug('TELEMETRY: MQTT broker re-connected!');
  });

  client.on('offline', () => {
    mqttConnected = false;
    deps.logger.debug('TELEMETRY: MQTT broker connection offline!');
  });

  client.on('close', () => {
    // connection state is also set to false in class close() method
    mqttConnected = false;
    deps.logger.debug('TELEMETRY: MQTT broker connection closed!');
  });

  client.on('error', (err) => {
    deps.logger.debug('TELEMETRY: MQTT error: ', err);
  });

}
module.exports = function (name, deps) {
  return new telemetry(name, deps);
};
