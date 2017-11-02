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

/*

Example OpenROV strings to convert to PRO4

START  camServ_inv(0);
START  camServ_spd(45000);
START  depth_water(0);
START  imu_level(0,0);
START  lift(0);
START  mtrmod1(100,100,-100);
START  mtrmod2(200,200,-200);
START  pitch(0);
START  roll(0);
START  strafe(0);
START  throttle(0);
START  wake();
START  yaw(0);

*/
const mqtt          = require('mqtt');
const EventEmitter  = require('events').EventEmitter;
const logger        = require('AppFramework.js').logger;
const pro4          = require('./pro4');

class Bridge extends EventEmitter
{
  constructor( mqttBrokerIp )
  {
    super();

    this.emitRawSerial = false;
    this.mqttConnected = false;
    this.client = {};
    this.mqttUri = 'ws://' + mqttBrokerIp + ':3000';
    this.parser = new pro4.Pro4();
    
    // Controllerboard State - emits to telemetry plugin?
    this.cb = 
    {
      time:         0,
      timeDelta_ms: 1000,

      brdvRampUp:   true,
      brdv:         5.0,
      vout:         5.0,
      iout:         2.0,
      bt1i:         0.0,
      bt2i:         0.0,
      baro_p:       0,
      baro_t:       0.0
    }

    // IMU State
    this.imu = 
    {
      time:         0,
      timeDelta_ms: 10,

      mode:         0,    // 0: GYRO, 1:MAG
      roll:         0,
      rollOffset:   0,
      pitch:        0,
      pitchOffset:  0,
      yaw:          0,
      yawOffset:    0,
      heading:      0
    }

    // Depth sensor state
    this.depthSensor =
    {
      time:         0,
      timeDelta_ms: 50,

      waterType:    0,  // 0: Fresh, 1: Salt
      depth:        0,
      depthOffset:  0,
      temperature:  0,
      pressure:     0
    }

    this.barometer = {
      temperature: 0,
      pressure:    0
    }

    this.depthHoldEnabled   = false;
    this.targetHoldEnabled  = false;
    this.laserEnabled       = false;

    // **************** SCINI specific platform hardware state ******************
    this.vehicleLights = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   700,  // loop interval in ms
      power:            0,    // 0 to 1
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST32LE,
        pro4Addresses:  [61, 62, 63, 64], // all updated to same value at same time
        flags:          2,    // defined by VideoRay
        csrAddress:     0,    // custom command address
        len:            4 * 3 // 3 led banks
      }
    }

    // This loop should only emit data on the bus if the
    // pilot requests action
    // payload first 2 bytes = 0x3549 
    // valid values: open = 3 close = 2 stationary = 0
    this.gripperControl = {
      time:             0,
      timeDelta_ms:     0,
      updateInterval:   250,  // loop interval in ms
      state:            0,    // 0 (stop), 2 (close), 3 (open)
      grippers:         [
        {
          name:         "Gripper 1 - unused",
          nodeId:       97,     // PRO4 packet ID
          state:        0
        },
        {
          name:         "Gripper 2 - unused",
          nodeId:       98,     // PRO4 packet ID
          state:        0
        },
        {
          name:         "Gripper 3 - unused",
          nodeId:       99,     // PRO4 packet ID
          motorId:      0,      // device protocol ID, position in PRO4 payload
          value:        0       // thrust value (-1 to +1)
        }
      ],
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST8LE,
        pro4Addresses:  [99], // all updated to same value at same time
        flags:          2,    // defined by VideoRay
        csrAddress:     0,    // custom command address
        len:            6
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
          name:         "stern thruster",
          nodeId:       31,     // PRO4 packet ID
          motorId:      0,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false   // boolean
        },
        {
          name:         "aft side",
          nodeId:       32,     // PRO4 packet IDar
          motorId:      1,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false   // boolean
        },
        {
          name:         "aft bottom",
          nodeId:       33,     // PRO4 packet ID
          motorId:      2,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false   // boolean
        },
        {
          name:         "fore side",
          nodeId:       34,     // PRO4 packet ID
          motorId:      3,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false   // boolean
        },
        {
          name:         "fore bottom",
          nodeId:       35,     // PRO4 packet ID
          motorId:      4,      // device protocol ID, position in PRO4 payload
          value:        0,      // thrust value (-1 to +1)
          reverse:      false   // boolean
        }
      ],
      pro4:             {
        pro4Sync:       pro4.constants.SYNC_REQUEST32LE,
        pro4Addresses:  [129],  // 0x81, multicast, see motors array above
        flags:          2,      // defined by VideoRay
        csrAddress:     0xf0,   // custom command address
        len:            2+4*5   // 2 command bytes + 4 byte float * number of motors 
      }
    }

  }

  connect()
  {
    let self = this; 
    
    logger.debug('BRIDGE: Starting connect() to MQTT broker');

    // Add status interval functions
    self.imuInterval    = setInterval( function() { return self.updateIMU; },          self.imu.timeDelta_ms );
    self.depthInterval  = setInterval( function() { return self.updateDepthSensor; },  self.depthsensortimeDelta_ms );
    self.cbInterval     = setInterval( function() { return self.updateCB; },           self.cb.timeDelta_ms );

    // Add SCINI device control interval functions
    self.lightsInterval = setInterval( function() { return self.updateLights(); },       self.vehicleLights.updateInterval );
    self.motorInterval  = setInterval( function() { return self.updateMotors(); },     self.motorControl.updateInterval );
    self.rotateMotorInterval = setInterval( function() { return self.rotateMotor(); },     self.motorControl.rotateInterval );


    // Connect to MQTT broker and setup all event handlers
    // Note that platform code is loaded before MQTT broker plugin, so the 
    // client may attempt a few reconnects until it is successful
    this.client = mqtt.connect(this.mqttUri, {
      protocolVersion: 4,
      resubscribe: true,
      will: {
        topic: 'status/openrov',
        payload: 'OpenROV MQTT client disconnected!',
        qos: 0,
        retain: false
      }
    });

    this.client.on('connect', () => {
      this.mqttConnected = true;
      logger.debug('BRIDGE: MQTT broker connection established!');
      logger.debug('BRIDGE: Creating surface subscriptions.');
      this.client.subscribe('status/+'); // receive all status topic messages
      this.client.subscribe('thrusters/+'); // receive all motor control responses 
      this.client.subscribe('sensors/+'); // receive all sensor telemetry
      this.client.subscribe('clump/+'); // receive all clump weight topics
      this.client.subscribe('vehicle/+'); // receive all vechicle topics
      this.client.subscribe('fromScini/+'); // receive all messages from the ROV
    });

    this.client.on('reconnect', () => {
      this.mqttConnected = true;
      logger.debug('BRIDGE: MQTT broker re-connected!');
    });
    
    this.client.on('offline', () => {
      this.mqttConnected = false;
      logger.debug('BRIDGE: MQTT broker connection offline!');
    });

    this.client.on('message', (topic, message) => {
      // message is a Buffer object, send to decoder
      let parsedObj = this.parser.decode(message);
      logger.debug('BRIDGE: Parsed message = ' + parsedObj.toString('hex'));
    });

    this.client.on('error', (err) => {
      logger.debug('BRIDGE: MQTT error: ',err);
    });

    this.client.on('close', () => {
      // connection state is also set to false in class close() method
      this.mqttConnected = false;
      logger.debug('BRIDGE: MQTT broker connection closed!');
    });
  }

  close()
  {
    let self = this;

    logger.debug('Received bridge close().  Closing MQTT broker connection and removing status update intervals.');

    // Remove status interval functions
    clearInterval( this.imuInterval );
    clearInterval( this.depthInterval );
    clearInterval( this.cbInterval );
    clearInterval( this.lightsInterval );
    //clearInterval( this.motorInterval );
    
    this.client.end(false, () => {
      logger.debug('MQTT this.client.end() returned.');
      this.mqttConnected = false;
    });
  }

  write( command )
  {
    let self = this;
    let commandParts  = command.split(/\(|\)/);
    let commandText   = commandParts[0];
    let parameters    = commandParts[ 1 ].split( ',' );

    // this could be where the device-specific protocol translation occurs
    // (ie: PRO4)
    // Need code to map messages to appropriate topics 
    // and PRO4 packets

    // Simulate the receipt of the above command
    switch (commandText) 
    {
      case 'version': 
      {
        this.emitStatus('ver:<<{{10024121ae3fa7fc60a5945be1e155520fb929dd}}>>');
        debug('ver:<<{{10024121ae3fa7fc60a5945be1e155520fb929dd}}>>');
        
        break;
      }

      case 'wake': 
      {
        this.emitStatus('awake:;');

        break;
      }

      case 'ex_hello': 
      {
        let helloGoodbye = parseInt( parameters[0] );

        if( helloGoodbye === 1 )
        {
          this.emitStatus('example:Hello!;');
        }
        else
        {
          this.emitStatus('example:Goodbye!;');
        }
        
        break;
      }

      case 'imu_mode':
      {
         this.imu.mode = parseInt( parameters[0] );
         this.emitStatus(`imu_mode:${this.imu.mode};`);

         break;
      }

      case 'imu_level':
      {
          // Echo back requested settings
          this.imu.rollOffset = this.decode( parseInt( parameters[0] ) );
          this.emitStatus("imu_roff:" + this.encode( this.imu.rollOffset ) + ";" );

          this.imu.pitchOffset = this.decode( parseInt( parameters[1] ) );
          this.emitStatus("imu_poff:" + this.encode( this.imu.pitchOffset ) + ";" );

          break;
      }

      case 'imu_zyaw':
      {
          // Set the current heading as the offset
          this.imu.yawOffset = this.imu.yaw;
          this.emitStatus(`imu_zyaw:ack;`);

          break;
      }

      case 'depth_zero':
      {
          // Set the current depth as the offset
          this.depthsensordepthOffset = this.depthsensordepth;
          this.emitStatus(`depth_zero:ack;`);

          break;
      }

      case 'depth_clroff':
      {
          // Set the depth offset to 0
          this.depthsensordepthOffset = 0;
          this.emitStatus(`depth_clroff:ack;`);

          break;
      }

      case 'depth_water':
      {
          this.depthsensorwaterType = parseInt( parameters[0] );
          this.emitStatus(`depth_water:${this.depthsensorwaterType};`);

          break;
      }

      case 'ping': 
      {
        this.emitStatus(`pong:${parameters[0]}`);
        logger.trace(`pong:${parameters[0]}`);
        break;
      }      

      case 'lights_tpow': 
      { 
        // Scale and limit thrust between 0 and 1 (maximums are 0, 1)   
        let power = parameters[0] / 1000;  
        power = Math.max(power, 0);
        power = Math.min(power, 0.7);

        // Update state object to be sent on next packet interval
        self.vehicleLights.power = power;
        
        // DEBUG: dump values sent by OpenROV after scale/limit
        logger.debug('Light value: ' + power);
        
        // Ack command
        setTimeout( function()
        {
          self.emitStatus('lights_pow:' + power );
        }, 250 );
        
        break;
      }

      case 'elights_tpow': 
      {
        // Ack command
        let power = parseInt( parameters[0] );
        this.emitStatus('elights_tpow:' + power );

        setTimeout( function()
        {
          // Move to target position
          self.emitStatus('elights_pow:' + power );
        }, 250 );

        break;
      }

      case 'camServ_tpos': 
      {
        // Ack command

        let pos = parseInt( parameters[0] );
        this.emitStatus('camServ_tpos:' + pos );

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
        this.emitStatus('camServ_inv:' + parameters[0] );
        break;
      }

      case 'camServ_spd': 
      {
        // Ack command
        let speed = parseInt( parameters[0] );
        this.emitStatus('camServ_spd:' + speed );
        break;
      }
      
      case 'eligt': 
      {
        this.emitStatus('LIGPE:' + parameters[0] / 100);
        logger.debug('External light status: ' + parameters[0] / 100);
        break;
      }

      case 'escp': 
      {
        this.emitStatus('ESCP:' + parameters[0]);
        logger.debug('ESC status: ' + parameters[0]);
        break;
      }

      case 'claser': 
      {
        if (this.laserEnabled) 
        {
          this.laserEnabled = false;
          this.emitStatus('claser:0');
          logger.debug('Laser status: 0');
        } 
        else 
        {
          this.laserEnabled = true;
          this.emitStatus('claser:255');
          logger.debug('Laser status: 255');
        }

        break;
      }

      case 'holdDepth_on': 
      {
        let targetDepth = 0;

        if (!this.depthHoldEnabled) 
        {
          targetDepth = this.depthsensordepth;
          this.depthHoldEnabled = true;
        }

        this.emitStatus('targetDepth:' + (this.depthHoldEnabled ? targetDepth.toString() : DISABLED));
        logger.debug('Depth hold enabled');
        break;
      }

      case 'holdDepth_off': 
      {
        targetDepth = -500;
        this.depthHoldEnabled = false;
        this.emitStatus('targetDepth:' + (this.depthHoldEnabled ? targetDepth.toString() : DISABLED));
        logger.debug('Depth hold disabled');
        break;
      }

      case 'holdHeading_on': 
      {
        let targetHeading = 0;
        targetHeading = this.imu.yaw;
        this.targetHoldEnabled = true;
        this.emitStatus('targetHeading:' + (this.targetHoldEnabled ? targetHeading.toString() : DISABLED));
        logger.debug('Heading hold enabled');
        break;
      }

      case 'holdHeading_off': 
      {
        let targetHeading = 0;
        targetHeading = -500;
        this.targetHoldEnabled = false;
        this.emitStatus('targetHeading:' + (this.targetHoldEnabled ? targetHeading.toString() : DISABLED));
        logger.debug('Heading hold disabled');
        break;
      }

      // Passthrough tests
      case 'example_to_foo': 
      {
        break; // unused for now
        this.emitStatus('example_foo:' + parameters[0]);
        break;
      }

      case 'example_to_bar': 
      {
        break; // unused for now
        this.emitStatus('example_bar:' + parameters[0]);
        break;
      }

      case 'gripper_open': 
      {
        this.emitStatus('gripper_open:' + parameters[0]);
        break;
      }

      case 'gripper_close': 
      {
        this.emitStatus('gripper_close:' + parameters[0]);
        break;
      }

      case 'gripper_stationary': 
      {
        this.emitStatus('gripper_stationary:' + parameters[0]);
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
        let scaleFactor = 0.083;  // openrov caps throttle values at 12

        // Scale and limit thrust between -0.65 and 0.65 (maximums are -1, 1)      
        thrust *= scaleFactor;  
        thrust = Math.max(thrust,-0.65);
        thrust = Math.min(thrust, 0.65);

        // Update state variable(s)
        if (self.motorControl.motors[0].reverse == true) {
          self.motorControl.motors[0].value = thrust * -1;          
        }
        else {
          self.motorControl.motors[0].value = thrust;          
        }

        // DEBUG: dump values sent by OpenROV
        logger.debug('Throttle value: ' + thrust);
        // Ack command
        self.emitStatus('throttle: ' + thrust );
        break;
      }

      case 'yaw':
      {
        let yaw = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let scaleFactor = 0.083;  // openrov caps throttle values at 12

        // Scale and limit thrust between -0.65 and 0.65 (maximums are -1, 1)      
        yaw *= scaleFactor;  
        yaw = Math.max(yaw,-0.65);
        yaw = Math.min(yaw, 0.65);

        // Update state variable(s)
        if (self.motorControl.motors[1].reverse == true) {
          self.motorControl.motors[1].value = yaw * -1;          
        }
        else {
          self.motorControl.motors[1].value = yaw;         
        }
        
        logger.debug('Sending yaw update: ' + command);
        // Ack command
        self.emitStatus('yaw:' + parameters[0] );
        break;
      }

      case 'lift':
      {
        let lift = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let scaleFactor = 0.083;  // openrov caps throttle values at 12

        // Scale and limit thrust between -0.65 and 0.65 (maximums are -1, 1)      
        lift *= scaleFactor;  
        lift = Math.max(lift,-0.65);
        lift = Math.min(lift, 0.65);

        // Update state variable(s)
        if (self.motorControl.motors[2].reverse == true) {
          self.motorControl.motors[2].value = lift * -1;          
        }
        else {
          self.motorControl.motors[2].value = lift;         
        }
        if (self.motorControl.motors[4].reverse == true) {
          self.motorControl.motors[4].value = lift * -1;          
        }
        else {
          self.motorControl.motors[4].value = lift;         
        }

        logger.debug('Sending lift update: ' + command);
        // Ack command
        self.emitStatus('lift:' + parameters[0] );
        break;
      }

      case 'pitch':
      {
        let pitch = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let scaleFactor = 0.083;  // openrov caps throttle values at 12

        // Scale and limit thrust between -0.65 and 0.65 (maximums are -1, 1)      
        pitch *= scaleFactor;  
        pitch = Math.max(pitch,-0.65);
        pitch = Math.min(pitch, 0.65);

        // Update state variable(s)
        if (self.motorControl.motors[4].reverse == true) {
          self.motorControl.motors[4].value = pitch * -1;          
        }
        else {
          self.motorControl.motors[4].value = pitch;         
        }

        logger.debug('Sending pitch update: ' + command);
        // Ack command
        self.emitStatus('pitch:' + parameters[0] );
        break;
      }

      case 'strafe':
      { 

        let strafe = parameters[0]; // must be converted to 32-bit IEEE 754 float in payload
        let scaleFactor = 0.083;  // openrov caps throttle values at 12

        // Scale and limit thrust between -0.65 and 0.65 (maximums are -1, 1)      
        strafe *= scaleFactor;  
        strafe = Math.max(strafe,-0.65);
        strafe = Math.min(strafe, 0.65);

        // Update state variable(s)
        if (self.motorControl.motors[1].reverse == true) {
          self.motorControl.motors[1].value = strafe * -1;          
        }
        else {
          self.motorControl.motors[1].value = strafe;         
        }
        if (self.motorControl.motors[3].reverse == true) {
          self.motorControl.motors[3].value = strafe * -1;          
        }
        else {
          self.motorControl.motors[3].value = strafe;         
        }
        
        logger.debug('Sending strafe update: ' + command);
        // Ack command
        self.emitStatus('strafe:' + parameters[0] );
        break;
      }

      default: 
      {
        logger.debug('Unsupported command: ' + commandText);
      }
    }

    // Echo this command back to the MCU
    this.emitStatus('cmd:' + command);
  }

  sendToMqtt ( command )
  {
    if( this.mqttConnected ) 
    {
      
      this.client.publish('toScini/elphel/request', command);
      if( this.emitRawSerial ) 
      {
        this.emit('serial-sent', command );
      }
    } 
    else
    {
      logger.debug('BRIDGE: DID NOT SEND TO ROV - Not connected');
    }
  }

  parseStatus( rawStatus )
  {
    let parts   = rawStatus.trim().split( ':' );
    
    if( parts.length === 2 )
    {
      if( !isNaN( parts[ 1 ] ) )
      {
        let status = {};
        status[ parts[ 0 ] ] = parts[ 1 ];
        return status;
      }
      else
      {
        logger.warn( "NAN RESULT: " + parts[ 1 ] );
      }
    }

    return null;
  }

  emitStatus( status )
  {
    let txtStatus = this.parseStatus(status);
    // hack for null status values being passed to handlers
    if (!txtStatus)
    {
      logger.debug('BRIDGE: Null status value');
      txtStatus={};
    }
    this.emit('status', txtStatus);

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

  normalizeAngle360( a )
  {
    return ((a > 360.0) ? (a - 360.0) : ((a < 0.0) ? (a + 360.0) : a));
  } 

  normalizeAngle180( a ) 
  {
    return ((a > 180.0) ? (a - 360.0) : ((a < -180.0) ? (a + 360.0) : a));
  }

  updateIMU()
  {
    // Update time
    this.imu.time += this.imu.timeDelta_ms;

    // Generate pitch -90:90 degrees
    this.imu.pitch = 90 * Math.sin( this.imu.time * ( Math.PI / 10000 ) );
    
    // Generate roll -90:90 degrees
    this.imu.roll = 90 * Math.sin( this.imu.time * ( Math.PI / 30000 ) );
    
    // Generate yaw between -120:120 degrees
    let baseYaw = 120 * Math.sin( this.imu.time * ( Math.PI / 10000 ) );

    // Handle mode switches (gyro mode is -180:180, mag mode is 0:360)
    if( this.imu.mode === 0 )
    {
      this.imu.yaw = baseYaw;
    }
    else if( this.imu.mode === 1 )
    {
      this.imu.yaw = normalizeAngle360( baseYaw );
    }

    // Create result string
    let result = "";
    result += 'imu_p:' + this.encode( this.imu.pitch - this.imu.pitchOffset ) + ';';
    result += 'imu_r:' + this.encode( this.imu.roll - this.imu.rollOffset )+ ';';

    // Handle imu mode for yaw/heading
    if( this.imu.mode === 0 )
    {
      // GYRO mode
      result += 'imu_y:' + this.encode( normalizeAngle180( this.imu.yaw - this.imu.yawOffset ) ) + ';';
    }
    else if( this.imu.mode === 1 )
    {
      // MAG mode
      result += 'imu_y:' + this.encode( this.imu.yaw ) + ';';
    }

    // Emit status update
    this.emit( 'status', this.parseStatus( result ) );
  }

  updateDepthSensor()
  {
    // Update time
    this.depthsensortime += this.depthsensortimeDelta_ms;

    // Generate depth from -10:10 meters
    this.depthsensordepth = 10 * Math.sin( this.depthsensortime * ( Math.PI / 20000 ) );

    // Generate temperature from 15:25 degrees
    this.depthsensortemperature = 20 + ( 5 * Math.sin( this.depthsensortime * ( Math.PI / 40000 ) ) );

    // Generate pressure from 50:70 kPa
    this.depthsensorpressure = 60 + ( 10 * Math.sin( this.depthsensortime * ( Math.PI / 40000 ) ) );

    // Create result string (Note: we don't bother to take into account water type or offsets w.r.t. temperature or pressure )

    let result = "";
    result += 'depth_d:' + this.encode( this.depthsensordepth - this.depthsensordepthOffset ) + ';';
    result += 'depth_t:' + this.encode( this.depthsensortemperature ) + ';';
    result += 'depth_p:' + this.encode( this.depthsensorpressure ) + ';';

    // Emit status update
    this.emit( 'status', parseStatus( result ) );
  }

  updateCB()
  {
    // Update time
    this.cb.time += this.cb.timeDelta_ms;

    // Generate a current baseline from 1:2 amps
    let currentBase = ( ( Math.random() * 1 ) + 1 );

    // Generate currents for each battery tube from the base current, deviation of +/- 0.2A
    this.cb.bt1i = currentBase + ( ( Math.random() * 0.4 ) - 0.2 );
    this.cb.bt2i = currentBase + ( ( Math.random() * 0.4 ) - 0.2 );

    // Get total current by adding the two tube currents
    this.cb.iout = this.cb.bt1i + this.cb.bt2i;

    // Generate board voltage (ramps up and down between 5V and 12V)
    if( this.cb.brdvRampUp )
    {
      this.cb.brdv += 0.5;
      if( this.cb.brdv >= 12 )
      {
        this.cb.brdvRampUp = false;
      }
    }
    else
    {
      this.cb.brdv -= 0.5;
      if( this.cb.brdv <= 5 )
      {
        this.cb.brdvRampUp = true;
      }
    }

    this.cb.vout = this.cb.brdv;

    //Generate internal pressure values
    this.cb.baro_p = 30000000;
    let num = Math.floor(Math.random()*1000000) + 1; // this will get a number between 1 and 99;
    num *= Math.floor(Math.random()*2) == 1 ? 1 : -1; // this will add minus sign in 50% of cases
    this.cb.baro_p += num;

    // Create result string
    let result = "";
    result += 'BT2I:' + this.cb.bt2i + ';';
    result += 'BT1I:' + this.cb.bt1i + ';';
    result += 'BRDV:' + this.cb.brdv + ';';
    result += 'vout:' + this.cb.vout + ';';
    result += 'iout:' + this.cb.iout + ';';
    result += 'time:' + this.cb.time + ';';
    result += 'baro_p:' + this.cb.baro_p + ';';
    result += 'baro_t:' + this.cb.baro_t + ';';

    // Emit status update
    this.emit( 'status', this.parseStatus( result ) );
  }

  // ****** SCINI specific device update functions ******
  updateLights()
  {
    let self = this;

    // Update time
    this.vehicleLights.time += this.vehicleLights.timeDelta_ms;
/* Pro4 payload values */
        /* REF: https://github.com/videoray/Thruster/blob/master/custom_command.h */
        let payloadCmd = 0xaa; // Sent as first byte of payload
        let motorId = 1; // Second byte of payload, Thruster ID that will reply 
    // Sample script output and payload data
    //[0.1, 0.2, 0.3]
    //f5:5f:3d:02:00:0c:2a:c9:ad:46:cd:cc:cc:3d:cd:cc:4c:3e:9a:99:99:3e:22:ad:d8:6e
    //Got response: 28 bytes
    //Turnaround time: 65.192223 mS
    //f0:0f:3d:02:f0:0e:c3:17:c1:d4:83:00:5a:07:42:66:e6:83:be:00:00:06:42:00:1a:c4:ab:7e

    // convert OpenROV light target power to 3 identical 32-bit LE floats and build payload
    let payload = new Buffer.allocUnsafe(this.vehicleLights.pro4.len);
    payload.writeFloatLE(this.vehicleLights.power, 0);
    payload.writeFloatLE(this.vehicleLights.power, 4);
    payload.writeFloatLE(this.vehicleLights.power, 8);

    // shorter name for easier reading
    let p = this.vehicleLights.pro4;

    // Generate new pro4 packet for each address and send to all light modules
    for (let i = 0; i < p.pro4Addresses.length; i++) {
      (function() {
        let j = i;  // loop closure
        // Packet len = Header + 4-byte CRC + payload + 4-byte CRC = 27
        let packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[j], p.flags, p.csrAddress, p.len, payload);
        // maintain light state by updating at least once per second
        self.sendToMqtt(packetBuf);
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

    // This is lights - replace with sample motor data
    // Sample script output and payload data
    //[0.1, 0.2, 0.3]
    //f5:5f:3d:02:00:0c:2a:c9:ad:46:cd:cc:cc:3d:cd:cc:4c:3e:9a:99:99:3e:22:ad:d8:6e
    //Got response: 28 bytes
    //Turnaround time: 65.192223 mS
    //f0:0f:3d:02:f0:0e:c3:17:c1:d4:83:00:5a:07:42:66:e6:83:be:00:00:06:42:00:1a:c4:ab:7e

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
      self.sendToMqtt(packetBuf);
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
          self.sendToMqtt(packetBuf);
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

    if (self.motorControl.responderIdx >= m.length 
        || self.motorControl.responderIdx < 0) {
          self.motorControl.responderIdx = 0;
    }
    else
      self.motorControl.responderIdx++;
  }

  updateGrippers()
  {
    let self = this;
    let packetBuf;
    
    // Update time
    this.gripperControl.time += this.gripperControl.timeDelta_ms;

    // Sent as first two bytes of payload
    let payloadCmd = 0x4935;

    // convert OpenROV target thrust to 32-bit LE floats and build payload
    let payload = new Buffer.allocUnsafe(this.gripperControl.pro4.len);
    
    // shorter names for easier reading
    let g = this.gripperControl.grippers;
    let p = this.gripperControl.pro4;

    payload.writeUInt16LE(p.payloadCmd, 0);  // device command for motor control
    payload.writeUInt8(g[0].state, 2);   // node ID of device to respond
/*
    if (p.pro4Addresses[0] & pro4.constants.ID_MULTICAST_FLAG) {
      // build payload from motor state object
      for (let i = 0; i < m.length; i++) {
        payload.writeFloatLE(m[i].value, 2+4*i);
      }
      // first address in array is a multicast group
      packetBuf = self.parser.encode(p.pro4Sync, p.pro4Addresses[0], p.flags, p.csrAddress, p.len, payload);
      // maintain state by updating at least once per second
      self.sendToMqtt(packetBuf);
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
          self.sendToMqtt(packetBuf);
        })();
      }
    }
    payload.writeUInt8(m.motorId, 1);     // motor ID we want to respond. should rotate

    let x, y;
    for (x = 0; y <  m.length; x++) {
      payload.writeFloatLE(thrust, 2);    
    }
    */
    logger.debug('Received gripper command, not used.');

  }
}

module.exports = Bridge;
