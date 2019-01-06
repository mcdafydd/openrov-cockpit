/*
   COPYRIGHT (C) David McPike

   All rights reserved.

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

   * Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.

   * Redistributions in binary form must reproduce the above copyright
     notice, this list of conditions and the following disclaimer in
     the documentation and/or other materials provided with the
     distribution.

   * Neither the name of the copyright holders nor the names of
     contributors may be used to endorse or promote products derived
     from this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.
*/

const mqtt          = require('mqtt');
const fs            = require( "fs" ) ;
const EventEmitter  = require('events').EventEmitter;
const logger        = require('AppFramework.js').logger;
const pro4          = require('./pro4');
const q             = require('queue');

/*
process.on('uncaughtException', err => {
  console.error(err, 'Uncaught Exception thrown');
  process.exit(1);
});
*/

// Setup buffered logging for telemetry
function addZero(i) {
  if (i < 10) {
    i = "0" + i;
  }
  return i;
}
const pino          = require('pino');
const months        = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d             = new Date();
const day           = addZero(d.getDate());
const h             = addZero(d.getHours());
const m             = addZero(d.getMinutes());
const ts            = day + months[d.getMonth()] + h + m;
const logDir        = '/opt/openrov/data/' + ts;
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, '0775');
}
// TODO: upgrade to pino v5 - we're using v3 in cockpit shrinkwrap for now
// v5 ref: https://github.com/pinojs/pino/blob/master/docs/extreme.md
const fd = fs.openSync(`${logDir}/${ts}.log`, 'w');
const dataLogger = pino({extreme: true}, fs.createWriteStream(null, {fd: fd}));
// CAREFUL! OpenROV's parent pino-arborsculpture level setting affects this logger too!
// We ALWAYS want dataLogger's messages saved to disk
dataLogger.level = 'warn'; // default level

let mqttConfigFile;
if(!fs.existsSync('/opt/openrov/config/mqttConfig.json') ||
      fs.statSync('/opt/openrov/config/mqttConfig.json').size === 0) {
  logger.error('BRIDGE: /opt/openrov/config/mqttConfig.json - file not found or zero size');
  logger.error('BRIDGE: Exiting...');
  process.exit(1);
}
else {
  mqttConfigFile = fs.readFileSync('/opt/openrov/config/mqttConfig.json');
}

class Bridge extends EventEmitter
{
  constructor( mqttBrokerIp, globalBus )
  {
    super();

    this.emitRawSerial = false;
    this.mqttConnected = false;
    this.client = {};
    this.globalBus = globalBus;
    this.mqttUri = 'ws://' + mqttBrokerIp + ':3000';
    this.parser = new pro4.Pro4();
    this.DISABLED = 'DISABLED';

    this.depthHoldEnabled   = false;
    this.targetHoldEnabled  = false;
    this.laserEnabled       = false;

    try {
      this.mqttConfig = JSON.parse(mqttConfigFile.toString());
    } catch (e) {
      logger.error(`BRIDGE: Exiting due to error parsing /opt/openrov/config/mqttConfig.json: ${e}`);
      process.exit(1);
    }
    this.mqttConfigId = {};  // used for reverse lookup on MQTT receive message

    // *********** SCINI concurrency control and parser state objects ****
    this.jobs = {};
    this.results = {};
    this.clients = {}; // links clientId to their parser
    this.qInterval = {};
    // *********** SCINI specific platform hardware request state *************
    this.sensors = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   1000,       // loop interval in ms
      navInterval:      250,        // nav display update interval in ms
      changed:          0,          // if <> 0 -> send nav update to browser next iteration
      ps:               {           // power supply
        brdvRampUp:   true,
        brdv:         5.0,
        vout:         5.0,
        iout:         2.0,
        bt1i:         0.0,
        bt2i:         0.0,
        baro_p:       0,
        baro_t:       0.0
      },
      imu:              {
        mode:         0,            // 0: GYRO, 1:MAG
        roll:         0,
        rollOffset:   0,
        pitch:        0,
        pitchOffset:  0,
        yaw:          0,
        yawOffset:    0,
        heading:      0
      },
      depth:            {
        waterType:    0,            // 0: Fresh, 1: Salt
        depth:        0,
        depthOffset:  0,
        temp:  0,
        pressure:     0
      },
      barometer:        {           // XXX - do we need this?
        temp:         0,
        pressure:     0
      },
      devices:           {
        51:             {
          location:     'clump',
          center:       0xbb80,
          speed:        8192
        },
        52:             {
          location:     'rov',
          center:       0x9088,
          speed:        9500
        },
        57:             {
          location:     'rov',
          center:       0x8000,
          speed:        8192
        },
        58:             {
          location:     'rov',
          center:       0xb478,
          speed:        8192
        },
        67:             {
          location:     'clump',
          center:       0x8000,
          speed:        8192
        }
      },
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [51, 52, 57, 58, 67], // aka "camera crumbs"
        flags:          0x00,       // or 0x80
        csrAddress:     0xf0,       // custom command address
        lenNoop:        6,          // no write, just read all values
        lenBam:         11,         // send write to control servos, GPIOs
        payloadHeader:  0x53434e49, // "SCNI" - beginning of request payloads
        payloadLenNoop: 2,          // no write, just read all values
        payloadLenBam:  7,          // send write to control servos, GPIOs
        payloadCmdNoop: 0,          // no write, just read all values
        payloadCmdBam:  0x02,       // send write to control servos, GPIOs
        payloadGpio:    0x00,       // 1 byte output bits
        noopPayload:    new Buffer.allocUnsafe(6),  // value should equal lenNoop
        bamPayload:     new Buffer.allocUnsafe(11)  // value should equal lenBam
      }
    }
    this.sensors.pro4.noopPayload.writeUInt32BE(this.sensors.pro4.payloadHeader, 0);   // "SCNI"
    this.sensors.pro4.noopPayload.writeUInt8(this.sensors.pro4.payloadLenNoop, 4);     // payload len
    this.sensors.pro4.noopPayload.writeUInt8(this.sensors.pro4.payloadCmdNoop, 5);     // payload cmd
    this.sensors.pro4.bamPayload.writeUInt32BE(this.sensors.pro4.payloadHeader, 0);    // "SCNI"
    this.sensors.pro4.bamPayload.writeUInt8(this.sensors.pro4.payloadLenBam, 4);       // payload len
    this.sensors.pro4.bamPayload.writeUInt8(this.sensors.pro4.payloadCmdBam, 5);       // payload cmd

    // separate board used to convert PRO4 to serial device communication
    this.boards44 = {
      updateInterval:   1000,       // loop interval in ms
      devices:           {
        81:             {
          name:         'keller',
          location:     'clump',
          commands:     [4],
          len:          1
        },
        82:             {
          name:         'keller and up-down lasers',
          location:     'rov',
          commands:     [4],
          len:          1
        },
        83:             {
          name:         'ps3',
          location:     'rov',
          commands:     [6],
          len:          1
        },
        84:             {
          name:         'reserved',
          location:     'rov',
          commands:     [],
          len:          1
        },
        85:             {
          name:         'ctsensor',
          location:     'rov',
          commands:     [3],
          len:          10
        },
        86:             {
          name:         'fwd laser',
          location:     'rov',
          commands:     [],
          len:          1
        },
        87:             {
          name:         'ps2',
          location:     'clump',
          commands:     [6],
          len:          1
        },
        88:             {
          name:         'reserved',
          location:     'rov',
          commands:     [],
          len:          1
        }
      },
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [81, 82, 83, 85, 87],
        flags:          0x00,       // or 0x80
        csrAddress:     0xf0,       // custom command address
        len:            1      // command payload is just a single byte
      }
    }

    this.rovLights = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   450,    // loop interval in ms
      devices:           {
        61:             { // 61 not used
          location:     'clump',
          power:        0.0
        },
        62:             {
          location:     'rov',
          power:        0.1
        },
        63:             {
          location:     'rov',
          power:        0.0
        },
        65:             {
          location:     'rov',
          power:        0.1  // signal the vehicle is responding
        },
        66:             {
          location:     'clump',
          power:        0.0
        }
      },
      pro4:             {
        sync:       pro4.constants.SYNC_REQUEST32LE,
        addresses:  [61, 62, 63, 65, 66], // all updated at same time
        flags:          2,          // defined by VideoRay
        csrAddress:     0,          // custom command address
        len:            4 * 3       // 3 led banks
      }
    }

    // This loop should only emit data on the bus if the
    // pilot requests action and device has not emitted fault
    // requested command stored in state property
    // payload first 2 bytes = 0x3549
    // valid command values: open = 3 close = 2 stationary = 0
    // cmdStatus: 0=idle, 1,2=opening, 3,4=closing, 5=braking, 6=overcurrent, 7=faulted
    // The gripper will halt if it does not receive a command every 1.25 seconds.
    this.gripperControl = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   500,  // loop interval in ms
      devices:             {
        23:             {
          name:         "Gripper 1",
          location:     "rov",
          command:      0,
          i_lim:        0x7fff
        },
        21:             {
          name:         "Gripper 2 - water sampler",
          location:     "rov",
          command:      0,
          i_lim:        0x7fff
        },
        24:             {
          name:         "Gripper 3 - trim",
          location:     "rov",
          command:      0,
          i_lim:        0x7fff
        },
      },
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [24, 23, 21], // all updated at same time
        flags:          0x80,  // defined by VideoRay
        csrAddress:     0,     // custom command address
        len:            4      // command payload is just a single byte
      }
    }

    // Multicast motor control is the preferred method of operation to reduce
    // serial contention and latency
    //
    // motors array of objects description
    // name = common name of motor position on vehicle
    // nodeId = PRO4 header node ID
    // motorId = part of device protocol payload, used in PRO4 multicast packets
    //           to control individual motor values in packet addressed to multiple
    //           devices starts at 0 indicating first payload value
    //
    this.motorControl = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   100,    // loop interval in ms
      rotateInterval:   5000,   // rotate motor responder every 5 seconds
      responderIdx:     0,      // motor array index that will respond to requests
      motors:           [
        {
          name:         "aft vertical",
          location:     "rov",
          nodeId:       12,     // PRO4 packet ID
          motorId:      0,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "aft horizontal",
          location:     "rov",
          nodeId:       13,     // PRO4 packet IDar
          motorId:      1,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "fore vertical",
          location:     "rov",
          nodeId:       14,     // PRO4 packet ID
          motorId:      2,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "fore horizontal",
          location:     "rov",
          nodeId:       15,     // PRO4 packet ID
          motorId:      3,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "thruster",
          location:     "rov",
          nodeId:       16,     // PRO4 packet ID
          motorId:      4,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        }
      ],
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST32LE,
        pro4Addresses:  [129],  // 129, multicast, see motors array above
        //pro4Addresses:  [12, 13, 14, 15, 16],  // 129, multicast, see motors array above
        flags:          2,      // defined by VideoRay
        csrAddress:     0xf0,   // custom command address
        len:            2+4*5,   // 2 command bytes + 4 byte float * number of motors
        payloadCmd:     0xaa   // defined by VideoRay
      }
    }

  }

  connect()
  {
    let self = this;

    logger.info('BRIDGE: Starting connect() to MQTT broker');

    // Add SCINI device control interval functions
    self.sensorInterval = setInterval( function() { return self.requestSensors(); }, self.sensors.updateInterval );
    self.boards44Interval = setInterval( function() { return self.requestBoards44(); }, self.boards44.updateInterval );
    self.navInterval = setInterval( function() { return self.updateNav(); }, self.sensors.navInterval );
    self.lightsInterval = setInterval( function() { return self.updateLights(); }, self.rovLights.updateInterval );
    self.motorInterval = setInterval( function() { return self.updateMotors(); }, self.motorControl.updateInterval );
    self.rotateMotorInterval = setInterval( function() { return self.rotateMotor(); }, self.motorControl.rotateInterval );

    // asynchronously flush every 10 seconds to keep the buffer empty
    // in periods of low activity
    self.dataLoggerInterval = setInterval(function () { dataLogger.flush(); }, 10000).unref();

    // Connect to MQTT broker and setup all event handlers
    // Note that platform code is loaded before MQTT broker plugin, so the
    // client may attempt a few reconnects until it is successful
    self.client = mqtt.connect(self.mqttUri, {
      protocolVersion: 4,
      resubscribe: true,
      clientId: 'bridge',
      keepalive: 15,
      will: {
        topic: 'status/openrov',
        payload: 'OpenROV MQTT client disconnected!',
        qos: 0,
        retain: false
      }
    });

    self.client.on('connect', () => {
      self.mqttConnected = true;
      logger.info('BRIDGE: MQTT broker connection established!');
      logger.info('BRIDGE: Creating surface subscriptions.');
      //self.client.subscribe('$SYS/+/new/clients');
      self.client.subscribe('status/+'); // receive all status topic messages
      self.client.subscribe('thrusters/+'); // receive all motor control responses
      self.client.subscribe('sensors/+'); // receive all sensor telemetry
      self.client.subscribe('clump/+'); // receive all clump weight topics
      self.client.subscribe('vehicle/+'); // receive all vechicle topics
      self.client.subscribe('servo/#'); // receive servo control commands
      self.client.subscribe('light/#'); // receive light control commands
      self.client.subscribe('grippers/#'); // receive gripper control commands
      self.client.subscribe('fromScini/#'); // receive all messages from the ROV
    });

    self.client.on('reconnect', () => {
      self.mqttConnected = true;
      logger.info('BRIDGE: MQTT broker re-connected!');
    });

    self.client.on('offline', () => {
      self.mqttConnected = false;
      logger.warn('BRIDGE: MQTT broker connection offline!');
    });

    self.client.on('message', (topic, message) => {
      // message is a Buffer object, send to decoder
      logger.warn('BRIDGE: Received MQTT topic = ' + topic + '; raw = ' + message.toString('hex'));

      if (topic.match('fromScini/.*') !== null) {
        self.handleRovMqtt(topic, message);
      }
      else if (topic.match('light/.*') !== null) {
        self.handleLightMqtt(topic, message);
      }
      else if (topic.match('servo/.*') !== null) {
        self.handleServoMqtt(topic, message);
      }
      else if (topic.match('grippers/.*') !== null) {
        self.handleGrippersMqtt(topic, message);
      }
      else {
        logger.warn('BRIDGE: No handler for MQTT message on topic ' + topic);
      }
    });

    self.client.on('error', (err) => {
      logger.error('BRIDGE: MQTT error: ', err);
    });

    self.client.on('close', () => {
      // connection state is also set to false in class close() method
      self.mqttConnected = false;
      logger.warn('BRIDGE: MQTT broker connection closed!');
    });

    self.globalBus.on('plugin.mqttBroker.clientConnected', (client) => {
      let clientId = client.id;
      let clientIp = client.connection.stream.remoteAddress;
      // add clientIp to mqttConfig if it doesn't exist
      if (!self.mqttConfig.hasOwnProperty(clientIp)) {
        self.mqttConfig[clientIp] = {};
      }
      if (!self.mqttConfig[clientIp].hasOwnProperty('receiveMqtt')) {
        self.mqttConfig[clientIp].receiveMqtt = false;
      }
      if (!self.mqttConfig[clientIp].hasOwnProperty('location')) {
        self.mqttConfig[clientIp].location = 'unspecified';
      }
      self.mqttConfig[clientIp].id = clientId;
      self.mqttConfigId[clientId] = clientIp;
      logger.info('BRIDGE: Received MQTT clientConnected() from ' + clientId);
      // create new message queue for each ROV MQTT gateway
      if (clientId.match('elphel.*') !== null &&
            self.mqttConfig[clientIp].receiveMqtt === true) {
        // create new state machine, parse buffer, and job queue
        // concurrency = 1 (one message in flight at a time)
        // max wait time for response = 60ms
        // autostart = always running if jobs are in queue
        self.clients[clientId] = new pro4.Pro4();
        // results stores most recent job callback
        self.results[clientId] = [];
        self.jobs[clientId] = new q({
                                      concurrency: 1,
                                      timeout: 200,
                                      autostart: true
                                    });
        // should manage 100% timeout case
        self.qInterval[clientId] = setInterval(
          function() {
            if (self.jobs[clientId] instanceof q) {
              if (self.jobs[clientId].length > 25) {
                logger.warn(`BRIDGE: Job queue backlog for ${clientId} reached ${self.jobs[clientId].length}; flushing`);
                // flush the queue - next job push() should restart it
                self.jobs[clientId].end()
              }
            }
          }, 5000);
        self.jobs[clientId].on('success', function () {
          logger.debug(`BRIDGE: sendToMqtt() callback from clientId ${clientId}`);
        });
        self.jobs[clientId].on('error', function (err) {
          self.emitStatus(`mqtt.error.${clientId}:1;`);
          logger.error(`BRIDGE: sendToMqtt() callback from clientId ${clientId} produced error = ${err}`);
        });
        self.jobs[clientId].on('timeout', function (next) {
          self.emitStatus(`mqtt.timeout.${clientId}:1;`);
          // remove callback from queue; if we receive this response after timeout
          // it won't advance queue
          self.results[clientId].shift();
          logger.debug(`BRIDGE: sendToMqtt() from clientId ${clientId} timed out`);
          next();
        });
        self.jobs[clientId].on('end', function () {
          logger.debug(`BRIDGE: all jobs done for clientId ${clientId}`);
        });
      }
    });
    self.globalBus.on('plugin.mqttBroker.clientDisconnected', (client) => {
      let clientId = client.id;
      logger.warn('BRIDGE: Received MQTT clientDisconnected() from ' + clientId);
      // stop and empty queue
      if (typeof(clientId) === 'string') {
        if (self.jobs.hasOwnProperty(clientId)) {
          if (self.jobs[clientId] instanceof q) {
            self.jobs[clientId].end();
          }
        }
        if (self.results.hasOwnProperty(clientId)) {
          self.results[clientId] = [];
        }
        if (self.clients.hasOwnProperty(clientId)) {
          delete self.clients[clientId];
        }
        if (self.qInterval.hasOwnProperty(clientId)) {
          clearInterval(self.qInterval[clientId]);
        }
      }
    });
    self.globalBus.on('plugin.mqttBroker.publishedByClientId', (client) => {
      if (typeof client !== 'undefined') {
        logger.debug('BRIDGE: MQTT message published by client ' + client.id);
      }
    });
  }


  close()
  {
    let self = this;

    logger.debug('BRIDGE: Received bridge close().  Closing MQTT broker connection and removing status update intervals.');

    // Remove status interval functions
    clearInterval( self.sensorInterval );
    clearInterval( self.boards44Interval );
    clearInterval( self.navInterval );
    clearInterval( self.lightsInterval );
    clearInterval( self.motorInterval );
    clearInterval( self.rotateInterval );
    clearInterval( self.dataLoggerInterval );

    self.client.end(false, () => {
      logger.debug('BRIDGE: MQTT self.client.end() returned.');
      self.mqttConnected = false;
    });

    // stop and empty job queues
    logger.debug('BRIDGE: Stopping and empyting all MQTT client job queues');
    for (let clientId in self.jobs) {
      if (self.jobs[clientId] instanceof q) {
        self.jobs[clientId].end();
      }
    }
    for (let clientId in self.results) {
      if (self.results.hasOwnProperty(clientId)) {
        self.results[clientId] = [];
      }
    }
    for (let clientId in self.clients) {
      if (self.clients.hasOwnProperty(clientId)) {
        delete self.clients[clientId];
      }
    }
    for (let clientId in self.qInterval) {
      if (self.qInterval.hasOwnProperty(clientId)) {
        clearInterval(self.qInterval[clientId]);
      }
    }
  }

  write( command )
  {
    let self = this;
    let commandParts  = command.split(/\(|\)/);
    let commandText   = commandParts[0];
    let parameters    = commandParts[ 1 ].split( ',' );

    switch (commandText)
    {
      case 'version':
      {
        self.emitStatus('ver:<<{{10024121ae3fa7fc60a5945be1e155520fb929dd}}>>');
        break;
      }

      case 'wake':
      {
        self.emitStatus('awake:;');
        break;
      }

      case 'ex_hello':
      {
        let helloGoodbye = parseInt( parameters[0] );

        if( helloGoodbye === 1 )
        {
          self.emitStatus('example:Hello!;');
        }
        else
        {
          self.emitStatus('example:Goodbye!;');
        }
        break;
      }

      case 'imu_mode':
      {
        self.sensors.imu.mode = parseInt( parameters[0] );
        self.emitStatus(`imu_mode:${self.sensors.imu.mode};`);
        break;
      }

      case 'imu_level':
      {
        // Echo back requested settings
        self.sensors.imu.rollOffset = self.decode( parseInt( parameters[0] ) );
        self.emitStatus("imu_roff:" + self.encode( self.sensors.imu.rollOffset ) + ";" );

        self.sensors.imu.pitchOffset = self.decode( parseInt( parameters[1] ) );
        self.emitStatus("imu_poff:" + self.encode( self.sensors.imu.pitchOffset ) + ";" );
        break;
      }

      case 'imu_zyaw':
      {
        // Set the current heading as the offset
        self.sensors.imu.yawOffset = self.sensors.imu.yaw;
        self.emitStatus(`imu_zyaw:ack;`);
        break;
      }

      case 'depth_zero':
      {
        // Set the current depth as the offset
        self.sensors.depth.depthOffset = self.sensors.depth.depth;
        self.emitStatus(`depth_zero:ack;`);
        break;
      }

      case 'depth_clroff':
      {
        // Set the depth offset to 0
        self.sensors.depth.depthOffset = 0;
        self.emitStatus(`depth_clroff:ack;`);
        break;
      }

      case 'depth_water':
      {
        self.sensors.depth.waterType = parseInt( parameters[0] );
        self.emitStatus(`depth_water:${self.sensors.depth.waterType};`);
        break;
      }

      case 'ping':
      {
        self.emitStatus(`pong:${parameters[0]}`);
        logger.trace(`pong:${parameters[0]}`);
        break;
      }

      // handles OpenROV cockpit legacy lights object
      case 'lights_tpow':
      {
        // Scale and limit power between 0 and 1 (maximums are 0, 1)
        let power = parameters[0] / 1000;
        power = Math.max(power, 0);
        power = Math.min(power, 1.0);

        // Update state object to be sent on next packet interval
        self.rovLights.devices['62'].power = power;

        // Ack command
        self.emitStatus(`light_tpow:${power};light_pow:${power};`);
        self.emitStatus('light.62.currentPower:' + parameters[0] + ';');
        break;
      }

      case 'elights_tpow':
      {
        // Scale and limit power between 0 and 1 (maximums are 0, 1)
        let power = parameters[0] / 1000;
        power = Math.max(power, 0);
        power = Math.min(power, 1.0);

        // Update state object to be sent on next packet interval
        self.rovLights.devices['66'].power = power;

        // Ack command
        self.emitStatus(`elights_tpow:${power};elights_pow:${power};`);
        self.emitStatus('light.66.currentPower:' + parameters[0] + ';');
        break;
      }

      case 'camServ_tpos':
      {
        // Ack command
        let pos = parseInt( parameters[0] );
        self.emitStatus(`camServ_tpos:${pos};camServ_pos:${pos};`);
        break;
      }

      case 'camServ_inv':
      {
        // Ack command
        self.emitStatus('camServ_inv:' + parameters[0] );

        break;
      }

      case 'camServ_spd':
      {
        // Ack command
        self.emitStatus('camServ_spd:' + parameters[0] );
        break;
      }

      case 'camServ_cmd':
      {
        self.updateServos(52, parameters[0]);
        // Ack command
        self.emitStatus('camServ_cmd:' + parameters[0] );
        break;
      }

      case 'camServ_scni_51':
      {
        self.updateServos(51, parameters[0]);
        // Ack command
        self.emitStatus('camServ_scni_51:' + parameters[0] );
        break;
      }

      case 'camServ_scni_52':
      {
        self.updateServos(52, parameters[0]);
        // Ack command
        self.emitStatus('camServ_scni_52:' + parameters[0] );
        break;
      }

      case 'camServ_scni_53':
      {
        self.updateServos(53, parameters[0]);
        // Ack command
        self.emitStatus('camServ_scni_53:' + parameters[0] );
        break;
      }

      case 'camServ_scni_54':
      {
        self.updateServos(54, parameters[0]);
        // Ack command
        self.emitStatus('camServ_scni_54:' + parameters[0] );
        break;
      }

      case 'camServ_scni_55':
      {
        self.updateServos(55, parameters[0]);
        // Ack command
        self.emitStatus('camServ_scni_55:' + parameters[0] );
        break;
      }

      case 'eligt':
      {
        self.emitStatus('LIGPE:' + parameters[0] / 100);
        break;
      }

      case 'escp':
      {
        self.emitStatus('ESCP:' + parameters[0]);
        break;
      }

      case 'claser':
      {
        if (self.laserEnabled)
        {
          self.laserEnabled = false;
          self.emitStatus('claser:0');
        }
        else
        {
          self.laserEnabled = true;
          self.emitStatus('claser:255');
        }

        break;
      }

      case 'holdDepth_on':
      {
        let targetDepth = 0;

        if (!self.depthHoldEnabled)
        {
          targetDepth = self.sensors.depth.depth;
          self.depthHoldEnabled = true;
        }

        self.emitStatus('targetDepth:' + (self.depthHoldEnabled ? targetDepth.toString() : self.DISABLED));
        break;
      }

      case 'holdDepth_off':
      {
        let targetDepth = -500;
        self.depthHoldEnabled = false;
        self.emitStatus('targetDepth:' + (self.depthHoldEnabled ? targetDepth.toString() : self.DISABLED));
        break;
      }

      case 'holdHeading_on':
      {
        let targetHeading = 0;
        targetHeading = self.sensors.imu.yaw;
        self.targetHoldEnabled = true;
        self.emitStatus('targetHeading:' + (self.targetHoldEnabled ? targetHeading.toString() : self.DISABLED));
        break;
      }

      case 'holdHeading_off':
      {
        let targetHeading = 0;
        targetHeading = -500;
        self.targetHoldEnabled = false;
        self.emitStatus('targetHeading:' + (self.targetHoldEnabled ? targetHeading.toString() : self.DISABLED));
        break;
      }

      case 'gripper_open':
      {
        self.updateGripper(21, 2);
        self.emitStatus(`gripper.open:1;gripper.close:0;`);
        break;
      }

      case 'gripper_close':
      {
        self.updateGripper(21, 3);
        self.emitStatus(`gripper.close:1;gripper.open:0;`);
        break;
      }

      case 'gripper_stationary':
      {
        self.updateGripper(21, 0);
        self.emitStatus(`gripper.stationary:1;gripper.close:0;gripper.open:0;`);
        break;
      }

      case 'sampler_open':
      {
        self.updateGripper(23, 2);
        self.emitStatus(`sampler.open:1;sampler.close:0;`);
        break;
      }

      case 'sampler_close':
      {
        self.updateGripper(23, 3);
        self.emitStatus(`sampler.close:1;sampler.open:0;`);
        break;
      }

      case 'sampler_stationary':
      {
        self.updateGripper(23, 0);
        self.emitStatus(`sampler.stationary:1;sampler.close:0;sampler.open:0;`);
        break;
      }
      case 'trim_open':
      {
        self.updateGripper(24, 2);
        self.emitStatus(`trim.open:1;trim.close:0;`);
        break;
      }

      case 'trim_close':
      {
        self.updateGripper(24, 3);
        self.emitStatus(`trim.close:1;trim.open:0;`);
        break;
      }

      case 'trim_stationary':
      {
        self.updateGripper(24, 0);
        self.emitStatus(`trim_stationary:1;trim_close:0;trim_open:0;`);
        break;
      }

      // forward thrust modifier - used for reverse flag detection
      case 'mtrmod1':
      {
        // Order of parameter values:
        // thruster, vertical, starboard, aftvertical, aftstarboard
        // Ack command (ex: mtrmod1(100,100,-100,100,-100));
        // main thruster
        if (parameters[0] < 0) {
          self.motorControl.motors[4].reverse = true;
          self.motorControl.motors[4].fwdMod = parameters[0] * 0.01;
        }
        else {
          self.motorControl.motors[4].reverse = false;
          self.motorControl.motors[4].fwdMod = parameters[0] * 0.01;
        }
        // forward vertical
        if (parameters[1] < 0) {
          self.motorControl.motors[2].reverse = true;
          self.motorControl.motors[2].fwdMod = parameters[1] * 0.01;
        }
        else {
          self.motorControl.motors[2].reverse = false;
          self.motorControl.motors[2].fwdMod = parameters[1] * 0.01;
        }
        // forward horizontal
        if (parameters[2] < 0) {
          self.motorControl.motors[3].reverse = true;
          self.motorControl.motors[3].fwdMod = parameters[2] * 0.01;
        }
        else {
          self.motorControl.motors[3].reverse = false;
          self.motorControl.motors[3].fwdMod = parameters[2] * 0.01;
        }
        // aft vertical
        if (parameters[3] < 0) {
          self.motorControl.motors[0].reverse = true;
          self.motorControl.motors[0].fwdMod = parameters[3] * 0.01;
        }
        else {
          self.motorControl.motors[0].reverse = false;
          self.motorControl.motors[0].fwdMod = parameters[3] * 0.01;
        }
        // aft horizontal
        if (parameters[4] < 0) {
          self.motorControl.motors[1].reverse = true;
          self.motorControl.motors[1].fwdMod = parameters[4] * 0.01;
        }
        else {
          self.motorControl.motors[1].reverse = false;
          self.motorControl.motors[1].fwdMod = parameters[4] * 0.01;
        }

        self.emitStatus('motors.mtrmod1:' + parameters );
        break;
      }

      // reverse thrust modifier
      case 'mtrmod2':
      {
        // Ack command (ex: mtrmod2(200,200,-200,200,-200));
        // main thruster
        if (parameters[0] < 0) {
          self.motorControl.motors[4].revMod = parameters[0] * 0.01;
        }
        else {
          self.motorControl.motors[4].revMod = parameters[0] * 0.01;
        }
        // forward vertical
        if (parameters[1] < 0) {
          self.motorControl.motors[2].revMod = parameters[1] * 0.01;
        }
        else {
          self.motorControl.motors[2].revMod = parameters[1] * 0.01;
        }
        // forward horizontal
        if (parameters[2] < 0) {
          self.motorControl.motors[3].revMod = parameters[2] * 0.01;
        }
        else {
          self.motorControl.motors[3].revMod = parameters[2] * 0.01;
        }
        // aft vertical
        if (parameters[3] < 0) {
          self.motorControl.motors[0].revMod = parameters[3] * 0.01;
        }
        else {
          self.motorControl.motors[0].revMod = parameters[3] * 0.01;
        }
        // aft horizontal
        if (parameters[4] < 0) {
          self.motorControl.motors[1].revMod = parameters[4] * 0.01;
        }
        else {
          self.motorControl.motors[1].revMod = parameters[4] * 0.01;
        }

        self.emitStatus('motors.mtrmod2:' + parameters );
        break;
      }

      case 'throttle':
      {
        // Response_Thruster_Standard {
        //   /** Measured shaft rotational velocity */
        //   float rpm;
        //  /** Bus voltage (Volts) */
        //   float bus_v;
        //   /** Bus current (Amps) */
        //   float bus_i;
        //   /** Temperature (Degree C) */
        //   float temp;
        //   /** fault flags */
        //  uint8_t fault;
        // }

        // ex: throttle(0);^M - commandParts[0] = throttle
        // aa = propulsion command
        // 00 = after 0xaa this indicates no   de to respond with status
        // 00000000 = IEEE 754 thruster value for thruster 1 (4 bytes)
        // 2b934509 = total crc
        // Example payload, single thruster value (thrust = 0):
        // f5:5f:81:02:f0:06:ab:30:60:e5:aa:00:00:00:00:00:2b:93:45:09
        // Example payload, three thruster values (0.9, -0.7, 0.3):
        // f5:5f:81:02:f0:0e:99:b8:bb:eb:aa:02:66:66:66:3f:33:33:33:bf:9a:99:99:3e:5a:c0:d5:bc
        // sync, 81 group addy
        // to calc 4-byte CRC (F55F/F00F)= buf.writeUInt32LE(CRC.crc32(b), 0)
        // to calc 1-byte CRC (FAAF/FDDF) = buf.writeUInt8(CRC.crc8(b), 0)
        // Update state object to be sent on next packet interval

        let thrust = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload

        // OpenROV sends values 0-100 based on system power level
        thrust *= 0.01;
        if (thrust > 0) {
          thrust *= self.motorControl.motors[4].fwdMod;
        }
        if (thrust < 0) {
          thrust *= self.motorControl.motors[4].revMod;
        }
        thrust = Math.max(thrust,-1.0);
        thrust = Math.min(thrust, 1.0);

        // Update state variable(s)
        if (self.motorControl.motors[4].reverse == true) {
          self.motorControl.motors[4].value = thrust * -1;
        }
        else {
          self.motorControl.motors[4].value = thrust;
        }

        // Ack command
        self.emitStatus('motors.throttle: ' + thrust );
        break;
      }

      case 'yaw':
      {
        let yaw = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let yaw2 = parameters[0]; // supports thruster modifiers

        // OpenROV sends values 0-100 based on system power level
        yaw *= 0.01;
        yaw2 *= 0.01;
        if (yaw > 0) {
          yaw *= self.motorControl.motors[1].fwdMod;
          yaw2 *= self.motorControl.motors[3].fwdMod;
        }
        if (yaw < 0) {
          yaw *= self.motorControl.motors[1].revMod;
          yaw2 *= self.motorControl.motors[3].revMod;
        }
        yaw = Math.max(yaw,-1.0);
        yaw = Math.min(yaw, 1.0);
        yaw2 = Math.max(yaw2,-1.0);
        yaw2 = Math.min(yaw2, 1.0);

        // Update state variable(s)
        if (self.motorControl.motors[1].reverse == true) {
          self.motorControl.motors[1].value = yaw * -1;
        }
        else {
          self.motorControl.motors[1].value = yaw;
        }
        if (self.motorControl.motors[3].reverse == true) {
          self.motorControl.motors[3].value = yaw2;
        }
        else {
          self.motorControl.motors[3].value = yaw2 * -1;
        }

        // Ack command
        self.emitStatus('motors.yaw:' + yaw );
        break;
      }

      case 'lift':
      {
        let lift = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let lift2 = parameters[0]; // supports thruster modifiers

        // OpenROV sends values 0-100 based on system power level
        lift *= 0.01;
        lift2 *= 0.01;
        if (lift > 0) {
          lift *= self.motorControl.motors[0].fwdMod;
          lift2 *= self.motorControl.motors[2].fwdMod;
        }
        if (lift < 0) {
          lift *= self.motorControl.motors[0].revMod;
          lift2 *= self.motorControl.motors[2].revMod;
        }
        lift = Math.max(lift,-1.0);
        lift = Math.min(lift, 1.0);
        lift2 = Math.max(lift2,-1.0);
        lift2 = Math.min(lift2, 1.0);

        // Update state variable(s)
        if (self.motorControl.motors[0].reverse == true) {
          self.motorControl.motors[0].value = lift * -1;
        }
        else {
          self.motorControl.motors[0].value = lift;
        }
        if (self.motorControl.motors[2].reverse == true) {
          self.motorControl.motors[2].value = lift2 * -1;
        }
        else {
          self.motorControl.motors[2].value = lift2;
        }

        // Ack command
        self.emitStatus('motors.lift:' + lift );
        break;
      }

      case 'pitch':
      {
        let pitch = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let pitch2 = parameters[0]; // supports thruster modifiers

        // OpenROV sends values 0-100 based on system power level
        pitch *= 0.01;
        pitch2 *= 0.01;
        if (pitch > 0) {
          pitch *= self.motorControl.motors[0].fwdMod;
          pitch2 *= self.motorControl.motors[2].fwdMod;
        }
        if (pitch < 0) {
          pitch *= self.motorControl.motors[0].revMod;
          pitch2 *= self.motorControl.motors[2].revMod;
        }
        pitch = Math.max(pitch,-1.0);
        pitch = Math.min(pitch, 1.0);
        pitch2 = Math.max(pitch,-1.0);
        pitch2 = Math.min(pitch, 1.0);

        // Update state variable(s)
        if (self.motorControl.motors[0].reverse == true) {
          self.motorControl.motors[0].value = pitch * -1;
        }
        else {
          self.motorControl.motors[0].value = pitch;
        }
        if (self.motorControl.motors[2].reverse == true) {
          self.motorControl.motors[2].value = pitch;
        }
        else {
          self.motorControl.motors[2].value = pitch * -1;
        }

        // Ack command
        self.emitStatus('motors.pitch:' + pitch );
        break;
      }

      case 'strafe':
      {

        let strafe = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let strafe2 = parameters[0]; // supports thruster modifiers

        // OpenROV sends values 0-100 based on system power level
        strafe *= 0.01;
        strafe2 *= 0.01;
        if (strafe > 0) {
          strafe *= self.motorControl.motors[1].fwdMod;
          strafe2 *= self.motorControl.motors[3].fwdMod;
        }
        if (strafe < 0) {
          strafe *= self.motorControl.motors[1].revMod;
          strafe2 *= self.motorControl.motors[3].revMod;
        }
        strafe = Math.max(strafe,-1.0);
        strafe = Math.min(strafe, 1.0);
        strafe2 = Math.max(strafe2,-1.0);
        strafe2 = Math.min(strafe2, 1.0);

        // Update state variable(s)
        if (self.motorControl.motors[1].reverse == true) {
          self.motorControl.motors[1].value = strafe * -1;
        }
        else {
          self.motorControl.motors[1].value = strafe;
        }
        if (self.motorControl.motors[3].reverse == true) {
          self.motorControl.motors[3].value = strafe2 * -1;
        }
        else {
          self.motorControl.motors[3].value = strafe2;
        }

        // Ack command
        self.emitStatus('motors.strafe:' + strafe );
        break;
      }

      default:
      {
        logger.debug('Unsupported command: ' + commandText);
      }
    }

    // Echo this command back to the MCU
    self.emitStatus('cmd:' + command);
  }

  addToPublishQueue(packetBuf, deviceLoc)
  {
    let self = this;

    if (deviceLoc !== 'rov' && deviceLoc !== 'clump') {
      deviceLoc = 'rov'; // default to vehicle queue
    }
    // only submit job to queue connected to device location
    for (let clientId in self.jobs) {
      if (self.mqttConfigId.hasOwnProperty(clientId)) {
        let clientIp = self.mqttConfigId[clientId];
        if (self.mqttConfig[clientIp].location === deviceLoc) {
          let job = function(cb) {
            return self.sendToMqtt(clientId, packetBuf, cb);
          }
          self.jobs[clientId].push(job);
        }
      }
    }
  }

  sendToMqtt(clientId, packetBuf, cb)
  {
    let self = this;

    // parser is only needed after sendToMqtt()
    // make sure to only reset parser if the queue still exists
    if (self.clients.hasOwnProperty(clientId)) {
      if (typeof self.clients[clientId].reset !== 'undefined') {
        self.clients[clientId].reset();
      }
    }
    if(self.mqttConnected)
    {
      self.client.publish('toScini/' + clientId, packetBuf);
      // defer callback until mqtt message receipt by temporarily storing job callback in self.results
      self.results[clientId].push(cb);
      logger.debug('BRIDGE: sendToMqtt() published for client ' + clientId + ' message = ' + packetBuf.toString('hex'));
      if(self.emitRawSerial)
      {
        self.emit('serial-sent', packetBuf);
      }
    }
    else
    {
      logger.warn('BRIDGE: DID NOT SEND TO ROV - client ' + clientId + ' not connected. Advancing queue.');
      cb();
    }
  }

  parseStatus(rawStatus)
  {
    let parts = rawStatus.trim().split(';');
    let status = {};
    for (let i = 0; i < parts.length; i++) {
      let subParts = parts[i].split(':');
      if (subParts.length === 2)
      {
        status[subParts[0]] = subParts[1];
      }
    }

    /* do we need to care about NaNs in status output?
    if(parts.length === 2)
    {
      if(!isNaN(parts[1]))
      {
        status[parts[0]] = parts[1];
      }
      else
      {
        logger.debug("NAN RESULT:" + parts[1]);
      }
    }*/

    return status;
  }

  // send data to telemetry plugin
  emitStatus(status)
  {
    let txtStatus = this.parseStatus(status);
    // hack for null status values being passed to handlers
    if (!txtStatus)
    {
      txtStatus={};
    }
    // emit to telemetry plugin
    this.globalBus.emit('mcu.status', txtStatus);
    // Archive telemetry update
    dataLogger.warn(txtStatus);

    if (this.emitRawSerial)
    {
      this.emit('serial-received', status);
    }
  }

  isConnected()
  {
    return this.mqttConnected;
  }

  startRawSerialData()
  {
    this.emitRawSerial = true;
  }

  stopRawSerialData()
  {
    this.emitRawSerial = false;
  }

  // Encoding helper functions
  encode( floatIn )
  {
      return parseInt( floatIn * 1000 );
  }

  decode( intIn )
  {
      return ( intIn * 0.001 );
  }

  mapTo(value, in_min, in_max, out_min, out_max)
  {
    return (value - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
  }

  /*
  normalizeAngle360( a )
  {
    return ((a > 360.0) ? (a - 360.0) : ((a < 0.0) ? (a + 360.0) : a));
  }

  normalizeAngle180( a )
  {
    return ((a > 180.0) ? (a - 360.0) : ((a < -180.0) ? (a + 360.0) : a));
  }
  */
  // ****** SCINI specific device update functions ******
  updateLights()
  {
    let self = this;
    let p = self.rovLights.pro4;
    let payload = new Buffer.allocUnsafe(p.len);

    // Sample light payload - light values [0.1, 0.2, 0.3]
    // Request:
    //f5:5f:3d:02:00:0c:2a:c9:ad:46:cd:cc:cc:3d:cd:cc:4c:3e:9a:99:99:3e:22:ad:d8:6e
    // Response:
    //f0:0f:3d:02:f0:0e:c3:17:c1:d4:83:00:5a:07:42:66:e6:83:be:00:00:06:42:00:1a:c4:ab:7e

    // Generate new pro4 packet for each nodeId and send to all three light modules
    for (let nodeId in self.rovLights.devices) {
      if (self.rovLights.devices[nodeId].power > 0) {
        // convert OpenROV light target power to 3 identical 32-bit LE floats and build payload
        payload.writeFloatLE(self.rovLights.devices[nodeId].power, 0);
        payload.writeFloatLE(self.rovLights.devices[nodeId].power, 4);
        payload.writeFloatLE(self.rovLights.devices[nodeId].power, 8);
        (function() {
          let id = nodeId;  // loop closure - do I still need this?
          // Packet len = Header + 4-byte CRC + payload + 4-byte CRC = 27
          let packetBuf = self.parser.encode(p.sync, id, p.flags, p.csrAddress, p.len, payload);
          // maintain light state by updating at least once per second
          // TODO: do I need to await/promise packetBuf?
          self.addToPublishQueue(packetBuf, self.rovLights.devices[nodeId].location);
        })();
      }
    }
  }

  updateMotors()
  {
    let self = this;
    let packetBuf;

    // Update time
    this.motorControl.time += this.motorControl.timeDelta_ms;
    // Sample motor payload
    // Request:
    //
    // Response:
    //

    // convert OpenROV target thrust to 32-bit LE floats and build payload
    let payload = new Buffer.allocUnsafe(this.motorControl.pro4.len);

    // shorter names for easier reading
    let m = this.motorControl.motors;
    let p = this.motorControl.pro4;

    payload.writeUInt8(p.payloadCmd, 0);  // device command for motor control
    payload.writeUInt8(m[self.motorControl.responderIdx].nodeId, 1);   // node ID of device to respond

    if (p.pro4Addresses[0] & pro4.constants.ID_MULTICAST_FLAG) {
      // build payload from motor state object
      for (let i = 0; i < m.length; i++) {
        payload.writeFloatLE(m[i].value, 2+4*i);
      }
      // first address in array is a multicast group
      packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[0], p.flags, p.csrAddress, p.len, payload);
      // maintain desired motor movement by updating at least once per second
      self.addToPublishQueue(packetBuf, 'rov');
    }
    else {
      // first address in array is not multicast
      // Generate new pro4 packet for each address and send to all motor modules
      for (let i = 0; i < m.length; i++) {
        (function() {
          let j = i;  // loop closure
          // Packet len = Header + 4-byte CRC + payload + 4-byte CRC = 27
          packetBuf = self.parser.encode(p.pro4Sync, m[j].nodeId, p.flags, p.csrAddress, p.len, payload);
          // maintain light state by updating at least once per second
          self.addToPublishQueue(packetBuf, 'rov');
        })();
      }
    }
  }

  rotateMotor()
  {
    let self = this;

    if (self.motorControl.responderIdx >= self.motorControl.motors.length-1 ||
        self.motorControl.responderIdx < 0) {
          self.motorControl.responderIdx = 0;
    }
    else
      self.motorControl.responderIdx++;
  }

  updateGripper(id, command)
  {
    let self = this;

    // shorter names for easier reading
    let g = self.gripperControl.devices;
    let p = self.gripperControl.pro4;
    // defaults
    let location = 'rov';
    let i_lim = 0x7fff;

    // Generate new pro4 packet and update state
    // Control+current packet format =
    // 6B header + 1B CRC + 1B command + 1B flag = 0 + 2B max current + 1B CRC = 12 bytes
    if (g.hasOwnProperty(id)) {
      g[id].command = command;
      if (g[id].hasOwnProperty('i_lim'))
        i_lim = g[id].i_lim;
      if (g[id].hasOwnProperty('location'))
        location = g[id].location;
    }
    let payload = new Buffer.allocUnsafe(p.len);
    payload.writeUInt8(command, 0);   // gripper command
    payload.writeUInt8(0, 1);         // flag should be 0
    payload.writeUInt16BE(i_lim, 2);  // max current
    let packetBuf = self.parser.encode(p.pro4Sync, id, p.flags, p.csrAddress, p.len, payload);
    self.addToPublishQueue(packetBuf, location);
  }

  // send crumb644 sensor request
  requestSensors()
  {
    let self = this;
    let location = 'rov';

    // shorter name for easier reading
    let p = self.sensors.pro4;

    // Update time -- fix this to only set in request or response for all
    // intervals
    self.sensors.time += self.sensors.timeDelta_ms;

    // Generate new pro4 packet for each address and send to all modules
    for (let i = 0; i < p.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        let id = p.pro4Addresses[j];
        if (self.sensors.devices.hasOwnProperty(id)) {
          if (self.sensors.devices[id].hasOwnProperty('location'))
            location = self.sensors.devices[id].location;
        }
        // Packet len = Header + 1-byte CRC + payload + 1-byte CRC = 14
        let packetBuf = self.parser.encode(p.pro4Sync, id, p.flags, p.csrAddress, p.lenNoop, p.noopPayload);
        self.addToPublishQueue(packetBuf, location);
      })();
    }

    logger.debug('BRIDGE: Sent Crumb644 NOOP request');
  }

  // send boards44 request
  requestBoards44()
  {
    let self = this;

    // shorter name for easier reading
    let p = self.boards44.pro4;
    let payload;

    for (let nodeId in self.boards44.devices) {
      for (let i = 0; i < self.boards44.devices[nodeId].commands.length; i++) {
        let cmd, len;
        if (self.boards44.devices.hasOwnProperty(nodeId)) {
          cmd = self.boards44.devices[nodeId].commands[i];
          len = self.boards44.devices[nodeId].len;
          payload = new Buffer.allocUnsafe(len);
          payload.writeUInt8(cmd, 0);
          if (cmd === 3) {
            // command 3 needs the ASCII string to send to the device
            payload.write('00:#030\r\n',1);
          }
          let packetBuf = self.parser.encode(p.pro4Sync, parseInt(nodeId), p.flags, p.csrAddress, len, payload);
          self.addToPublishQueue(packetBuf, self.boards44.devices[nodeId].location);
          logger.debug(`BRIDGE: Queued Boards44 command ${cmd} for nodeId ${nodeId}, buf = ${packetBuf.toString('hex')}`);
        }
      }
    }
  }

  updateServos(nodeId, value)
  {
    let self = this;
    let location = 'rov';

    // shorter name for easier reading
    let p = self.sensors.pro4;

    let payload = new Buffer.allocUnsafe(p.lenBam);
    p.bamPayload.copy(payload);

    // value = 0 is servo off; 1 and 65535 are maximum either dir
    if (value < 1) { value = 1 }
    else if (value > 0xfffe) { value = 0xfffe }
    // we only care about servo 1 at the moment
    logger.debug(`BRIDGE: Updating servo on sensor ID ${nodeId} to value ${value}`);
    payload.writeUInt16LE(value, 6);            // payload servo1
    payload.writeUInt16LE(0x0000, 8);           // payload servo2
    payload.writeUInt8(p.payloadGpio, 10);      // payload gpio

    nodeId = parseInt(nodeId);
    if (self.sensors.devices.hasOwnProperty(nodeId)) {
      if (self.sensors.devices[nodeId].hasOwnProperty('location'))
        location = self.sensors.devices[nodeId].location;
    }
    // Generate new pro4 packet for each address and send to all modules
    // Packet len = Header + 1-byte CRC + payload + 1-byte CRC = 14
    let packetBuf = self.parser.encode(p.pro4Sync, nodeId, p.flags, p.csrAddress, p.lenBam, payload);
    self.addToPublishQueue(packetBuf, location);
  }

  // Updates nav sensor state values, IMU, depth sensors, etc. if reply to
  // requestSensors() comes from the pilot device
  updateSensors(parsedObj)
  {
    logger.debug('BRIDGE: Updating sensors');
    let self = this;
    let p = parsedObj.device;
    // Update time
    self.sensors.time += self.sensors.timeDelta_ms;

    // apply additional sensor transformations here, if needed
    self.sensors.imu.pitch = p.angle_x;
    self.sensors.imu.roll = p.angle_y;
    self.sensors.imu.yaw = 0;  // ignore yaw for now

    self.sensors.changed = 1;
  }

  // Updates nav sensor state values, IMU, depth sensors, etc. if reply to
  // requestSensors() comes from the pilot device
  updateKeller(parsedObj)
  {
    logger.debug('BRIDGE: Updating depth/pressure');
    let self = this;
    let p = parsedObj.device;

    self.sensors.depth.temp = p.temp;
    self.sensors.depth.pressure = p.pressure;
    self.sensors.depth.depth = p.depth;

    self.sensors.changed = 1;
  }

  // Send power supply values, IMU, depth sensors, etc. to browser
  updateNav()
  {
    logger.debug('BRIDGE: Updating nav data');
    let self = this;

    if (self.sensors.changed)
    {
      let result = "";
      // Handle imu mode for yaw/heading
      if(self.sensors.imu.mode === 0)
      {
        // GYRO mode
        //result += 'imu_y:' + self.encode( normalizeAngle180( self.sensors.imu.yaw - self.sensors.imu.yawOffset ) ) + ';';
        result += 'imu_y:' + self.encode(self.sensors.imu.yaw - self.sensors.imu.yawOffset) + ';';
      }
      else if(self.sensors.imu.mode === 1)
      {
        // MAG mode
        result += 'imu_y:' + self.encode(self.sensors.imu.yaw) + ';';
      }

      // Create result string (Note: we don't bother to take into account water type or offsets w.r.t. temperature or pressure )
      result += 'imu_p:' + self.encode(self.sensors.imu.pitch - self.sensors.imu.pitchOffset) + ';';
      result += 'imu_r:' + self.encode(self.sensors.imu.roll - self.sensors.imu.rollOffset) + ';';
      result += 'depth_d:' + self.encode(self.sensors.depth.depth - self.sensors.depth.depthOffset) + ';';
      result += 'depth_t:' + self.encode(self.sensors.depth.temp) + ';';
      result += 'depth_p:' + self.encode(self.sensors.depth.pressure) + ';';
      self.emitStatus(result);
      self.sensors.changed = 0;
    }
  }

  // handle MQTT messages from the ROV
  handleRovMqtt(topic, message)
  {
    let self = this;
    // use client-specific topic and pass handling to appropriate parser
    let clientId = topic.split('/', 2)[1];
    let clientIp;
    if (self.mqttConfigId.hasOwnProperty(clientId))
      clientIp = self.mqttConfigId[clientId];
    // only send messages from elphel gateways to parser
    if (clientId.match('elphel.*') !== null &&
          self.mqttConfig[clientIp].receiveMqtt === true) {
      let parsedObj = self.clients[clientId].parse(message);
      if (parsedObj.status == pro4.constants.STATUS_SUCCESS)
      {
        let cb = self.results[clientId].shift();
        if (cb instanceof Function) {
          cb(); // advance queue
        }
        let status = '';
        logger.debug('BRIDGE: Successfully parsed ROV PRO4 packet, advancing job queue; message = ', message.toString('hex'));

        if (parsedObj.type == 'pilot')
        {
          self.updateSensors(parsedObj); // handles IMU calculations and sending sensor data to cockpit widgets
        }
        else if (parsedObj.type == 'gripper' || parsedObj.type == 'sampler' || parsedObj.type == 'trim')
        {
          let cmdStatus = parseInt(parsedObj.device.cmdStatus);
          if (cmdStatus === 0) {
            self.gripperControl.devices[parsedObj.id].command = 0;
          }
          // If status is opening/closing, queue new command every second
          else if (cmdStatus >= 1 && cmdStatus <= 4) {
            setTimeout(function() {
              self.updateGripper(parsedObj.id, self.gripperControl.devices[parsedObj.id].command);
            }, 1000)
          }
          // If status is braking/overcurrent, send idle command
          else if (cmdStatus === 5 || cmdStatus === 6) {
            self.gripperControl.devices[parsedObj.id].command = 0;
            self.updateGripper(parsedObj.id, self.gripperControl.devices[parsedObj.id].command);
          }
        }
        else if (parsedObj.type == 'board44')
        {
          if (parsedObj.device.cmd == 3) {
            let matcher = parsedObj.device.ct.match(/(.*)\t(.*)\t(.*)\r\n/);
            if (matcher !== null) {
              parsedObj.device.rolloverCounter = parseInt(matcher[1]);
              parsedObj.device.temp = parseFloat(matcher[2]);
              parsedObj.device.conductivity = parseFloat(matcher[3]);
            }
          }
          // handles keller depth calculations
          else if (parsedObj.device.cmd == 4) {
            let density = 1024; // kg/m^3
            let gravity = 9.83143461; // m/s^2 - Intl. gravity formula at -83.1 latitude

            // ignore data for any other status value
            if (parsedObj.device.status === 0x40) {
              parsedObj.device.depth = (parsedObj.device.pressure*100000)/(density*gravity); // assumes pressure in bar
              if (parsedObj.id == 82)
                self.updateKeller(parsedObj); // handles sending data to cockpit widget
            }
          }
          // adds board44bam conversions as new telemetry fields
          // retain original values
          else if (parsedObj.device.cmd == 6) {
            // change two temp sensors from voltage to celsius
            if (parsedObj.device.hasOwnProperty('adc1')) {
              parsedObj.device.adc1temp = parsedObj.device.adc1 * 100 - 273.15;
            }
            if (parsedObj.device.hasOwnProperty('adc7')) {
              parsedObj.device.adc7temp = parsedObj.device.adc7 * 100 - 273.15;
            }
          }
        }
        else if (parsedObj.type == 'notfound')
        {
          logger.warn('BRIDGE: Device ID parser not found for ID = ', parsedObj.id);
          let msg = message.toString('hex');
          self.emitStatus(`notfound.${parsedObj.id}:${msg};`);
        }
        // send parsed device data to browser telemetry plugin
        for (let prop in parsedObj.device)
        {
          if (typeof parsedObj.device[prop] == 'object')
          {
            for (let i = 0; i < parsedObj.device[prop].length; i++)
            {
              status += `${parsedObj.type}.${prop}.${parsedObj.id}.${i}:${parsedObj.device[prop]};`;
            }
          }
          else
          {
            status += `${parsedObj.type}.${prop}.${parsedObj.id}:${parsedObj.device[prop]};`;
          }
        }
        self.emitStatus(status);
      }
      else if (parsedObj.status == pro4.constants.STATUS_MOREDATA)
      {
        logger.debug('BRIDGE: Waiting for more data; message = ', message.toString('hex'));
      }
      else if (parsedObj.status == pro4.constants.STATUS_ERROR)
      {
        // XXX - should advance queue if error occurs after _s_sync1, but
        let cb = self.results[clientId].shift();
        if (cb instanceof Function) {
          cb('unable to parse buffer'); // advance queue and pass back error to queue listener
        }
        logger.warn('BRIDGE: Error in PRO4 message parser; message = ', message.toString('hex'));
      }
      else // invalid status
      {
        self.results[clientId].shift(); // allow queue to timeout
        logger.warn('BRIDGE: Invalid PRO4 parser status = ', parsedObj.status, ' ; message = ', message.toString('hex'));
      }
    }
  }

  // handle ROV light control requests
  // Topic format: light/<nodeId>
  // Message contains power value
  handleLightMqtt(topic, message)
  {
    let self = this;
    let nodeId = topic.split('/', 2)[1];
    let power = parseFloat(message);

    logger.debug(`BRIDGE: Updating light power on node ID ${nodeId} to value ${power}`);
    // validate values
    power = Math.max(power, 0);
    power = Math.min(power, 1.0);
    if (self.rovLights.devices.hasOwnProperty(nodeId)) {
      self.rovLights.devices[nodeId].power = power;
      // echo new value back to telemetry plugin / browser clients
      self.emitStatus(`light.${nodeId}.currentPower:${self.rovLights.devices[nodeId].power}`);
    }

    logger.debug('BRIDGE: Received light control message for nodeId ', nodeId);
  }

  // handle ROV servo control requests
  // Topic format: servo/<nodeId>/<func>
  // Accept only valid messages, send valid values to device
  handleServoMqtt(topic, message)
  {
    let self = this;
    let nodeId = topic.split('/', 3)[1];
    let func = topic.split('/', 3)[2];
    let value = parseInt(message);

    logger.debug(`BRIDGE: Received servo ${func} on node ID ${nodeId} value ${value}`);
    if (func === 'move')
      self.updateServos(nodeId, value);
    else if (func === 'speed') {
      self.sensors.devices[nodeId].speed = value;
    }
    else if (func === 'center') {
      self.sensors.devices[nodeId].center = value;
    }
    else
      logger.debug('BRIDGE: Received invalid servo control message ', value, ' for nodeId ', nodeId);
    // echo new value back to telemetry plugin / browser clients
    self.emitStatus(`servo.${nodeId}.center:${self.sensors.devices[nodeId].center}`);
    self.emitStatus(`servo.${nodeId}.speed:${self.sensors.devices[nodeId].speed}`);
  }

  // handle ROV gripper, sampler, trim control requests
  // Topic format: grippers/<nodeId>
  // Accept only valid messages, send valid values to device
  handleGrippersMqtt(topic, message)
  {
    let self = this;
    let nodeId = topic.split('/', 2)[1];
    let value = parseInt(message);
    if (value === 0 || value === 2 || value === 3) {
      self.updateGripper(nodeId, value);
    }
    else {
      logger.debug('BRIDGE: Received invalid gripper control message ', value, ' for nodeId ', nodeId);
    }
  }
}

module.exports = Bridge;
