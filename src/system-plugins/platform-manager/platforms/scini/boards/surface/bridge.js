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
const EventEmitter  = require('events').EventEmitter;
const logger        = require('AppFramework.js').logger;
const pro4          = require('./pro4');
const q             = require('queue');
const request       = require('request');

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

    // *********** SCINI concurrency control and parser state objects ****
    this.jobs = {};
    this.results = {};
    // this object hold data and index for incoming MQTT messages
    this.clients = {}; // links clientId to their parserBuffer
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
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [42, 51, 52], // ps crumbs = 41, 43, camera crumbs = 53, 54, 55; 64 spare address
        flags:          0x00,       // or 0x80
        csrAddress:     0xf0,       // custom command address
        lenNoop:        6,          // no write, just read all values
        lenBam:         11,         // send write to control servos, GPIOs
        payloadHeader:  0x53434e49, // "SCNI" - beginning of request payloads
        payloadLenNoop: 2,          // no write, just read all values
        payloadLenBam:  7,          // send write to control servos, GPIOs
        payloadCmdNoop: 0,          // no write, just read all values
        payloadCmdBam:  0x02,       // send write to control servos, GPIOs
        payloadServo1:  0x0000,     // 2 byte servo 1 angle
        payloadServo2:  0x0000,     // 2 byte servo 2 angle
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

    this.clumpLights = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   700,        // loop interval in ms
      power:            0,          // 0 to 1
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST32LE,
        pro4Addresses:  [65, 66], // all updated at same time
        flags:          2,          // defined by VideoRay
        csrAddress:     0,          // custom command address
        len:            4 * 3       // 3 led banks
      }
    }

    this.vehicleLights = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   700,        // loop interval in ms
      power:            0,          // 0 to 1
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST32LE,
        pro4Addresses:  [61, 62, 63], // all updated at same time - note these are NOT hex addresses
        flags:          2,          // defined by VideoRay
        csrAddress:     0,          // custom command address
        len:            4 * 3       // 3 led banks
      }
    }

    // This loop should only emit data on the bus if the
    // pilot requests action
    // payload first 2 bytes = 0x3549
    // valid values: open = 3 close = 2 stationary = 0
    this.gripperControl = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   500,  // loop interval in ms
      grippers:         [
        {
          name:         "Gripper 1",
          nodeId:       24,  // PRO4 packet ID
          state:        0      // 0 (stop), 2 (close), 3 (open)
        },
        {
          name:         "Gripper 2 - water sampler",
          nodeId:       23,   // PRO4 packet ID
          state:        0       // 0 (stop), 2 (close), 3 (open)
        },
        {
          name:         "Gripper 3 - trim",
          nodeId:       21,  // PRO4 packet ID
          state:        0      // 0 (stop), 2 (close), 3 (open)
        }
      ],
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [24, 23, 21], // all updated at same time
        flags:          0x80,  // defined by VideoRay
        csrAddress:     0,     // custom command address
        len:            1      // command payload is just a single byte
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
          nodeId:       12,     // PRO4 packet ID
          motorId:      0,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "aft horizontal",
          nodeId:       13,     // PRO4 packet IDar
          motorId:      1,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "fore vertical",
          nodeId:       14,     // PRO4 packet ID
          motorId:      2,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "fore horizontal",
          nodeId:       15,     // PRO4 packet ID
          motorId:      3,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false,  // boolean
          fwdMod:       1.0,    // final forward thrust modifier
          revMod:       1.0     // final reverse thrust modifier
        },
        {
          name:         "thruster",
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

    logger.debug('BRIDGE: Starting connect() to MQTT broker');

    // Add SCINI device control interval functions
    self.sensorInterval = setInterval( function() { return self.requestSensors(); },          self.sensors.updateInterval );
    self.navInterval = setInterval( function() { return self.updateNav(); },          self.sensors.navInterval );
    self.lightsInterval = setInterval( function() { return self.updateLights(); },       self.vehicleLights.updateInterval );
    self.motorInterval = setInterval( function() { return self.updateMotors(); },     self.motorControl.updateInterval );
    self.rotateMotorInterval = setInterval( function() { return self.rotateMotor(); },     self.motorControl.rotateInterval );
    self.gripperInterval = setInterval( function() { return self.requestGrippers(); },     self.gripperControl.updateInterval );


    // Connect to MQTT broker and setup all event handlers
    // Note that platform code is loaded before MQTT broker plugin, so the
    // client may attempt a few reconnects until it is successful
    self.client = mqtt.connect(self.mqttUri, {
      protocolVersion: 4,
      resubscribe: true,
      will: {
        topic: 'status/openrov',
        payload: 'OpenROV MQTT client disconnected!',
        qos: 0,
        retain: false
      }
    });

    self.client.on('connect', () => {
      self.mqttConnected = true;
      logger.debug('BRIDGE: MQTT broker connection established!');
      logger.debug('BRIDGE: Creating surface subscriptions.');
      self.client.subscribe('status/+'); // receive all status topic messages
      self.client.subscribe('thrusters/+'); // receive all motor control responses
      self.client.subscribe('sensors/+'); // receive all sensor telemetry
      self.client.subscribe('clump/+'); // receive all clump weight topics
      self.client.subscribe('vehicle/+'); // receive all vechicle topics
      self.client.subscribe('fromScini/#'); // receive all messages from the ROV
    });

    self.client.on('reconnect', () => {
      self.mqttConnected = true;
      logger.debug('BRIDGE: MQTT broker re-connected!');
    });

    self.client.on('offline', () => {
      self.mqttConnected = false;
      logger.debug('BRIDGE: MQTT broker connection offline!');
    });

    self.client.on('message', (topic, message) => {
      // message is a Buffer object, send to decoder
      logger.debug('BRIDGE: Received MQTT on topic ' + topic);
      logger.warn('BRIDGE: Raw MQTT message = ' + message.toString('hex'));

      // use client-specific topic and pass handling to appropriate parser
      let clientId = topic.split('/', 2)[1];
      // only send messages from elphel gateways to parser
      if (clientId.match('elphel.*') !== null) {
        let parsedObj = self.parser.parse(message);
        if (parsedObj.status == pro4.constants.STATUS_SUCCESS)
        {
          logger.debug('BRIDGE: Successfully parsed ROV PRO4 packet, advancing job queue; message = ', message.toString('hex'));
          self.jobs[clientId].cb(); // advance queue

          if (parsedObj.type == 'pilot')
          {
            self.updateSensors(parsedObj); // handles IMU calculations and sending sensor data to cockpit
          }
          // send parsed device data to browser telemetry plugin
          for (let prop in parsedObj.device)
          {
            if (typeof parsedObj.device[prop] == 'object')
            {
              for (let i = 0; i < parsedObj.device[prop].length; i++)
              {
                self.emitStatus(`${parsedObj.type}.${prop}.${parsedObj.id}.${i}:${parsedObj.device[prop]}`);
              }
            }
            else
            {
              self.emitStatus(`${parsedObj.type}.${prop}.${parsedObj.id}:${parsedObj.device[prop]}`);
            }
          }
        }
        else if (parsedObj.status == pro4.constants.STATUS_MOREDATA)
        {
          logger.debug('BRIDGE: Waiting for more data; message = ', message.toString('hex'));
        }
        else if (parsedObj.status == pro4.constants.STATUS_ERROR)
        {
          logger.warn('BRIDGE: Error in PRO4 message parser; message = ', message.toString('hex'));
          self.jobs[clientId].cb(); // advance queue
        }
        else // invalid status
        {
          logger.warn('BRIDGE: Invalid PRO4 parser status = ', parsedObj.status, ' ; message = ', message.toString('hex'));
        }
      }
    });

    self.client.on('error', (err) => {
      logger.debug('BRIDGE: MQTT error: ', err);
    });

    self.client.on('close', () => {
      // connection state is also set to false in class close() method
      self.mqttConnected = false;
      logger.debug('BRIDGE: MQTT broker connection closed!');
    });

    self.globalBus.on('plugin.mqttBroker.clientConnected', (client) => {
      let clientId = client.id;
      logger.debug('BRIDGE: Received MQTT clientConnected() from ' + clientId);
      // create new message queue for each ROV MQTT gateway
      if (clientId.match('elphel.*') !== null) {
        // create new state machine, parse buffer, and job queue
        // concurrency = 1 (one message in flight at a time)
        // max wait time for response = 20ms
        // autostart = always running if jobs are in queue
        // results = store
        self.clients[clientId] = {};
        self.clients[clientId].bufIdx = 0; // points to end of received data in parseBuffer
        self.clients[clientId].parseIdx = 0; // points to current parser index
        self.clients[clientId].parseBuffer = new Buffer.alloc(1024);
        self.results[clientId] = new q({
                                      concurrency: 1,
                                      timeout: 25,
                                      autostart: true,
                                      results: self.results[clientId]
                                    });
        self.jobs[clientId] = new q({
                                      concurrency: 1,
                                      timeout: 25,
                                      autostart: true,
                                      results: self.results[clientId]
                                    });
        self.jobs[clientId].cb = function() {
          // do nothing
          return true;
        }
        self.jobs[clientId].on('error', function (err, job) {
          logger.error('BRIDGE: sendToMqtt() from clientId ', clientId, 'produced error: ', err);
        });
        self.jobs[clientId].on('timeout', function (next, job) {
          logger.debug('BRIDGE: sendToMqtt() from clientId ', clientId, 'timed out; resetting parser state machine');
          next();
        });
        self.jobs[clientId].on('end', function () {
          logger.debug('BRIDGE: all jobs done for clientId ', clientId);
        });
      }
    });
    self.globalBus.on('plugin.mqttBroker.clientDisconnected', (client) => {
      let clientId = client.id;
      logger.debug('BRIDGE: Received MQTT clientDisconnected() from ' + clientId);
      // stop and empty queue
      if (typeof(clientId) != 'undefined') {
        if (clientId.match('elphel.*') !== null) {
          self.results[clientId] = [];
          self.jobs[clientId].end();
        }
      }
      delete self.clients[clientId];
    });
    self.globalBus.on('plugin.mqttBroker.publishedByClientId', (client) => {
      logger.debug('BRIDGE: MQTT message published by client ' + client);
    });
  }

  close()
  {
    let self = this;

    logger.debug('BRIDGE: Received bridge close().  Closing MQTT broker connection and removing status update intervals.');

    // Remove status interval functions
    clearInterval( self.sensorInterval );
    clearInterval( self.navInterval );
    clearInterval( self.lightsInterval );
    clearInterval( self.motorInterval );
    clearInterval( self.rotateInterval );
    // clearInterval( self.gripperInterval);

    self.client.end(false, () => {
      logger.debug('BRIDGE: MQTT self.client.end() returned.');
      self.mqttConnected = false;
    });

    // stop and empty job queues
    logger.debug('BRIDGE: Empty and stop MQTT client job queues');
    // stop and empty queue
    if (clientId.match('elphel.*') !== null) {
      self.results[clientId] = [];
      self.jobs[clientId].end();
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

      case 'lights_tpow':
      {
        // Scale and limit power between 0 and 1 (maximums are 0, 1)
        let power = parameters[0] / 1000;
        power = Math.max(power, 0);
        power = Math.min(power, 1.0);

	      // Ack command
        self.emitStatus('lights_tpow:' + parameters[0] );
        self.emitStatus('lights.currentPower:' + parameters[0] );

        // Update state object to be sent on next packet interval
        self.vehicleLights.power = power;

        // Ack command
        setTimeout( function()
        {
          self.emitStatus('lights_pow:' + power );
        }, 250 );

        break;
      }

      case 'elights_tpow':
      {
        // Scale and limit power between 0 and 1 (maximums are 0, 1)
        let power = parameters[0] / 1000;
        power = Math.max(power, 0);
        power = Math.min(power, 1.0);

        // Ack command
        self.emitStatus('elights_tpow:' + power );

        // Update state object to be sent on next packet interval
        self.clumpLights.power = power;

        // Ack command
        setTimeout( function()
        {
          self.emitStatus('elights_pow:' + power );
        }, 250 );

        break;
      }

      case 'camServ_tpos':
      {
        // Ack command

        let pos = parseInt( parameters[0] );
        self.emitStatus('camServ_tpos:' + pos );

        setTimeout( function()
        {
          // Move to target position
          self.emitStatus('camServ_pos:' + pos );
        }, 250 );

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
        self.updateServos(parameters[0]);
        // Ack command
        self.emitStatus('camServ_cmd:' + parameters[0] );
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
        self.updateGripper(self.gripperControl.grippers[0].nodeId, 2);
        self.emitStatus(`gripper.open:1;gripper.close:0;`);
        break;
      }

      case 'gripper_close':
      {
        self.updateGripper(self.gripperControl.grippers[0].nodeId, 3);
        self.emitStatus(`gripper.close:1;gripper.open:0;`);
        break;
      }

      case 'gripper_stationary':
      {
        self.updateGripper(self.gripperControl.grippers[0].nodeId, 0);
        self.emitStatus(`gripper.stationary:1;gripper.close:0;gripper.open:0;`);
        break;
      }

      case 'sampler_open':
      {
        self.updateGripper(self.gripperControl.grippers[1].nodeId, 2);
        self.emitStatus(`sampler.open:1;sampler.close:0;`);
        break;
      }

      case 'sampler_close':
      {
        self.updateGripper(self.gripperControl.grippers[1].nodeId, 3);
        self.emitStatus(`sampler.close:1;sampler.open:0;`);
        break;
      }

      case 'sampler_stationary':
      {
        self.updateGripper(self.gripperControl.grippers[1].nodeId, 0);
        self.emitStatus(`sampler.stationary:1;sampler.close:0;sampler.open:0;`);
        break;
      }
      case 'trim_open':
      {
        self.updateGripper(self.gripperControl.grippers[2].nodeId, 2);
        self.emitStatus(`trim.open:1;trim.close:0;`);
        break;
      }

      case 'trim_close':
      {
        self.updateGripper(self.gripperControl.grippers[2].nodeId, 3);
        self.emitStatus(`trim.close:1;trim.open:0;`);
        break;
      }

      case 'trim_stationary':
      {
        self.updateGripper(self.gripperControl.grippers[2].nodeId, 0);
        self.emitStatus(`trim_stationary:1;trim_close:0;trim_open:0;`);
        break;
      }

      // forward thrust modifier - used for reverse flag detection
      case 'mtrmod1':
      {
        // Order of parameter values:
        // thruster, vertical, starboard, aftvertical, aftstarboard
        // Ack command (ex: mtrmod1(100,100,-100,100,-100));
        if (parameters[0] < 0) {
          self.motorControl.motors[0].reverse = true;
          self.motorControl.motors[0].fwdMod = parameters[0] * 0.01;
        }
        else {
          self.motorControl.motors[0].reverse = false;
          self.motorControl.motors[0].fwdMod = parameters[0] * 0.01;
        }
        if (parameters[1] < 0) {
          self.motorControl.motors[4].reverse = true;
          self.motorControl.motors[4].fwdMod = parameters[1] * 0.01;
        }
        else {
          self.motorControl.motors[4].reverse = false;
          self.motorControl.motors[4].fwdMod = parameters[1] * 0.01;
        }
        if (parameters[2] < 0) {
          self.motorControl.motors[3].reverse = true;
          self.motorControl.motors[3].fwdMod = parameters[2] * 0.01;
        }
        else {
          self.motorControl.motors[3].reverse = false;
          self.motorControl.motors[3].fwdMod = parameters[2] * 0.01;
        }
        if (parameters[3] < 0) {
          self.motorControl.motors[2].reverse = true;
          self.motorControl.motors[2].fwdMod = parameters[3] * 0.01;
        }
        else {
          self.motorControl.motors[2].reverse = false;
          self.motorControl.motors[2].fwdMod = parameters[3] * 0.01;
        }
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
        if (parameters[0] < 0) {
          self.motorControl.motors[0].revMod = parameters[0] * 0.01;
        }
        else {
          self.motorControl.motors[0].revMod = parameters[0] * 0.01;
        }
        if (parameters[1] < 0) {
          self.motorControl.motors[4].revMod = parameters[1] * 0.01;
        }
        else {
          self.motorControl.motors[4].revMod = parameters[1] * 0.01;
        }
        if (parameters[2] < 0) {
          self.motorControl.motors[3].revMod = parameters[2] * 0.01;
        }
        else {
          self.motorControl.motors[3].revMod = parameters[2] * 0.01;
        }
        if (parameters[3] < 0) {
          self.motorControl.motors[2].revMod = parameters[3] * 0.01;
        }
        else {
          self.motorControl.motors[2].revMod = parameters[3] * 0.01;
        }
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

  addToPublishQueue ( packetBuf )
  {
    let self = this;
    // keep it simple - add packetBuf to each client queue (queues only get created on one gateway per serial bus)
    for ( let clientId in self.jobs ) {
      let cb = self.jobs[clientId].cb;
      self.jobs[clientId].push(function (cb) { return self.sendToMqtt(clientId, packetBuf); });
    }
  }

  addToParseQueue ( clientId, packetBuf )
  {
    let self = this;
    let cb = self.results[clientId].cb;
    self.results[clientId].push(function (cb) { return self.parser.parse(packetBuf); });
  }

  sendToMqtt ( clientId, packetBuf )
  {
    let self = this;
    self.parser.reset(); // reset state machine
    if( self.mqttConnected )
    {
      self.client.publish('toScini/' + clientId, packetBuf);
      if( self.emitRawSerial )
      {
        self.emit('serial-sent', packetBuf );
      }
    }
    else
    {
      logger.debug('BRIDGE: DID NOT SEND TO ROV - client ' + clientId + ' not connected');
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

    // Update time
    self.vehicleLights.time += self.vehicleLights.timeDelta_ms;
    self.clumpLights.time += self.clumpLights.timeDelta_ms;
    // Sample light payload - light values [0.1, 0.2, 0.3]
    // Request:
    //f5:5f:3d:02:00:0c:2a:c9:ad:46:cd:cc:cc:3d:cd:cc:4c:3e:9a:99:99:3e:22:ad:d8:6e
    // Response:
    //f0:0f:3d:02:f0:0e:c3:17:c1:d4:83:00:5a:07:42:66:e6:83:be:00:00:06:42:00:1a:c4:ab:7e

    // convert OpenROV light target power to 3 identical 32-bit LE floats and build payload
    let payload = new Buffer.allocUnsafe(self.vehicleLights.pro4.len);
    payload.writeFloatLE(self.vehicleLights.power, 0);
    payload.writeFloatLE(self.vehicleLights.power, 4);
    payload.writeFloatLE(self.vehicleLights.power, 8);

    let clumpPayload = new Buffer.allocUnsafe(self.clumpLights.pro4.len);
    clumpPayload.writeFloatLE(self.clumpLights.power, 0);
    clumpPayload.writeFloatLE(self.clumpLights.power, 4);
    clumpPayload.writeFloatLE(self.clumpLights.power, 8);

    // shorter name for easier reading
    let p = self.vehicleLights.pro4;
    let p2 = self.clumpLights.pro4;

    // Generate new pro4 packet for each address and send to all light modules
    for (let i = 0; i < p.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        // Packet len = Header + 4-byte CRC + payload + 4-byte CRC = 27
        let packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[j], p.flags, p.csrAddress, p.len, payload);
        // maintain light state by updating at least once per second
        self.addToPublishQueue(packetBuf);
      })();
    }

    // Generate new pro4 packet for each address and send to all light modules
    for (let i = 0; i < p2.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        // Packet len = Header + 4-byte CRC + payload + 4-byte CRC = 27
        let packetBuf = self.parser.encode(p2.pro4Sync, p2.pro4Addresses[j], p2.flags, p2.csrAddress, p2.len, clumpPayload);
        // maintain light state by updating at least once per second
        self.addToPublishQueue(packetBuf);
      })();
    }

    // Emit status update
    // this.emit( 'status', this.parseStatus( result ) );
    //this.emit( 'status', this.parseStatus( result ) );
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
      // maintain state by updating at least once per second
      self.addToPublishQueue(packetBuf);
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
          self.addToPublishQueue(packetBuf);
        })();
      }
    }

    let x, y;
    for (x = 0; y <  m.length; x++) {
      payload.writeFloatLE(thrust, 2);
    }

    // Emit status update
    // this.emit( 'status', this.parseStatus( result ) );
    //this.emit( 'status', this.parseStatus( result ) );
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

  requestGrippers()
  {
    let self = this;

    // Update time
    self.gripperControl.time += self.gripperControl.timeDelta_ms;

    // shorter names for easier reading
    let g = self.gripperControl.grippers;
    let p = self.gripperControl.pro4;

    // Generate new pro4 packet for each address and send to all
    for (let i = 0; i < g.length; i++)
    {
      (function() {
        let j = i;  // loop closure
        // Packet len = 6-byte header + 1-byte CRC = 7
        let packetBuf = self.parser.encode(p.pro4Sync, g[j].nodeId, p.flags, p.csrAddress, 0, 0);
        // maintain state by updating at least once per second
        self.addToPublishQueue(packetBuf);
      })();
    }
  }

  updateGripper(id, command)
  {
    let self = this;

    // shorter names for easier reading
    let g = self.gripperControl.grippers;
    let p = self.gripperControl.pro4;

    // Generate new pro4 packet
    // Packet len = 6-byte header + 1-byte CRC + 1-byte payload + 1-byte CRC = 9
    let payload = new Buffer.allocUnsafe(p.len);
    payload.writeUInt8(command, 0);   // gripper command
    let packetBuf = self.parser.encode(p.pro4Sync, id, p.flags, p.csrAddress, p.len, payload);
    // maintain state by updating at least once per second
    self.addToPublishQueue(packetBuf);
  }

  // send crumb644 sensor request
  requestSensors()
  {
    let self = this;

    // shorter name for easier reading
    let p = self.sensors.pro4;

    // Update time -- fix this to only set in request or response for all
    // intervals
    self.sensors.time += self.sensors.timeDelta_ms;

    // Generate new pro4 packet for each address and send to all modules
    for (let i = 0; i < p.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        // Packet len = Header + 1-byte CRC + payload + 1-byte CRC = 14
        let packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[j], p.flags, p.csrAddress, p.lenNoop, p.noopPayload);
        self.addToPublishQueue(packetBuf);
      })();
    }

    logger.debug('BRIDGE: Sent Crumb644 NOOP request');
  }

  updateServos(value)
  {
    // we only care about servo 1 at the moment

    let self = this;
    // shorter name for easier reading
    let p = self.sensors.pro4;

    let payload = new Buffer.allocUnsafe(p.lenBam);

    p.bamPayload.copy(payload);
    payload.writeUInt16LE(value, 6);            // payload servo1
    payload.writeUInt16LE(p.payloadServo2, 8);  // payload servo2
    payload.writeUInt8(p.payloadGpio, 10);      // payload gpio

    // Generate new pro4 packet for each address and send to all modules
    for (let i = 0; i < p.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        // Packet len = Header + 1-byte CRC + payload + 1-byte CRC = 14
        let packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[j], p.flags, p.csrAddress, p.lenBam, payload);
        self.addToPublishQueue(packetBuf);
      })();
    }
  }

  // Updates power supply values, IMU, depth sensors, etc. after request
  updateSensors(parsedObj)
  {
    logger.debug('BRIDGE: Updating sensors');
    let self = this;
    let p = parsedObj.device;
    let density = 1024; // kg/m^3
    let gravity = 9.80665; // m/s^2 - should add local gravity anomaly
    let depth = p.kellerPressure/(density*gravity); // assumes pressure in pascals
    // Update time
    self.sensors.time += self.sensors.timeDelta_ms;

    // apply additional sensor transformations here, if needed
    self.sensors.depth.temp = p.kellerTemperature;
    self.sensors.depth.pressure = p.kellerPressure;
    self.sensors.depth.depth = depth;
    self.sensors.imu.pitch = p.angle_y;
    self.sensors.imu.roll = p.angle_x;
    self.sensors.imu.yaw = 0;  // ignore yaw for now

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
}

module.exports = Bridge;
