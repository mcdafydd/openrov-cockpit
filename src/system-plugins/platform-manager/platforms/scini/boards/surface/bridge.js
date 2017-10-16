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
const mqtt = require('mqtt');
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
    
    // Controllerboard State
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
  }

  connect()
  {
    var self = this; 
    
    logger.debug('BRIDGE: Starting connect() to MQTT broker');

    // Add status interval functions
    self.imuInterval    = setInterval( function() { return self.updateIMU; },          self.imu.timeDelta_ms );
    self.depthInterval  = setInterval( function() { return self.updateDepthSensor; },  self.depthsensortimeDelta_ms );
    self.cbInterval     = setInterval( function() { return self.updateCB; },           self.cb.timeDelta_ms );

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
      // message is Buffer
      logger.debug('BRIDGE: ' + message.toString());
    });

    this.client.on('error', (err) => {
      logger.debug('BRIDGE: MQTT error: ',err);
    });

    this.client.on('close', () => {
      // connection state is also set to false in class close() method
      this.mqttConnected = false;
      logger.debug('BRIDGE: MQTT broker connection closed!');
    });

    let parser = new pro4();
/*
    // Review parser function
    parser.on('data', (data) =>
    {
      let status = this.parseStatus( data.toString('utf8' ) );

      // If valid status message received, emit status events
      if( status !== null )
      {
        this.emit('status', status);

        if( this.emitRawSerial ) 
        {
          this.emit('serial-recieved', data + '\n');
        }
      }
    }); 
    */
  }

  close()
  {
    logger.debug('Received bridge close().  Closing MQTT broker connection and removing status update intervals.');

    // Remove status interval functions
    clearInterval( this.imuInterval );
    clearInterval( this.depthInterval );
    clearInterval( this.cbInterval );
    
    this.client.end(false, () => {
      logger.debug('MQTT this.client.end() returned.');
      this.mqttConnected = false;
    });
  }

  write( command )
  {
    // Create buffer for crc+command
    let pro4Buffer = new Buffer( pro4.PROTOCOL_PRO4_HEADER_SIZE + command.length + 1 );

    let commandParts  = command.split(/\(|\)/);
    let commandText   = commandParts[0];
    let parameters    = commandParts[ 1 ].split( ',' );

    // this could be where the device-specific protocol translation occurs
    // (ie: PRO4)
    // Need code to map messages to appropriate topics 
    // and PRO4 packets

    // Write payload to buffer, skipping header
    pro4Buffer.writeUInt8BE( command, pro4.PROTOCOL_PRO4_HEADER_SIZE);

    // dump buffer to console
    console.dir(pro4Buffer);

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
        let pro4Address = 0x62; // default thruster group id
        let flags = 2; // defined by VideoRay
        let length = 6; // XXX

        // Ack command
        let power = parseInt( parameters[0] );
        this.emitStatus('lights_tpow:' + power );

        setTimeout( function()
        {
          // Move to target position
          this.emitStatus('lights_pow:' + power );
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
          this.emitStatus('elights_pow:' + power );
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
          this.emitStatus('camServ_pos:' + pos );
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
        this.emitStatus('example_foo:' + parameters[0]);
        break;
      }

      case 'example_to_bar': 
      {
        this.emitStatus('example_bar:' + parameters[0]);
        break;
      }

      case 'gripper_open': 
      {
        let pro4Address = 0x23; // default thruster group id
        let flags = 2; // defined by VideoRay
        let length = 6; // XXX

        // 35 49 open = 3 close = 2 stationary = 0
        this.emitStatus('gripper_open:' + parameters[0]);
        break;
      }

      case 'gripper_close': 
      {
        let pro4Address = 0x23; // default thruster group id
        let flags = 2; // defined by VideoRay
        let length = 6; // XXX

        this.emitStatus('gripper_close:' + parameters[0]);
        break;
      }

      case 'gripper_stationary': 
      {
        let pro4Address = 0x23; // default thruster group id
        let flags = 2; // defined by VideoRay
        let length = 6; // XXX

        this.emitStatus('gripper_stationary:' + parameters[0]);
        break;
      }

      case 'throttle':
      {

        let pro4Address = 0xff; // default thruster group id 0x81
        let flags = 2; // VideoRay - send RESPONSE_THRUSTER_STANDARD payload in response
        let length = 6;
        let motor_id = 2; // Thruster ID that will reply with Response_Thruster_Standard

        // thruster.py -c /dev/ttyUSB0 -i 2 -m 2 0.5 0.5 0.85
        // Baud = 115200
        // Node group ID = 0xff, ideally 0x81 would be better
        // docs at http://download.videoray.com/documentation/m5_thruster/html/commands_responses.html

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

        //const uint8_t command;      // must be set to PROPULSION_COMMAND;
        //uint8_t node_id_to_reply;   // protocol node address for the device which should send a response
        //float *power_target;        // Variable length array of normalized power set point -1 to 1 (negative number are reverse)

        // ex: throttle(0);^M - commandParts[0] = throttle
        // parameters[0] = -12 to 12
        // need to scale as in thruster.py
        // ab3060e5 = header crc
        // aa = propulsion command
        // 00 = after 0xaa this indicates node to respond with status
        // 00000000 = IEEE 754 thruster value for thruster 1 (4 bytes)
        // 2b934509 = total crc       
        // f5:5f:81:02:f0:06:ab:30:60:e5:aa:00:00:00:00:00:2b:93:45:09
        // sync, 81 group addy


        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending throttle update: ' + command);
        // Ack command
        this.emitStatus('throttle:' + parameters[0] );
        break;
      }

      case 'yaw':
      {
        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending yaw update: ' + command);
        // Ack command
        this.emitStatus('yaw:' + parameters[0] );
        break;
      }

      case 'lift':
      {
        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending lift update: ' + command);
        // Ack command
        this.emitStatus('lift:' + parameters[0] );
        break;
      }

      case 'pitch':
      {
        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending pitch update: ' + command);
        // Ack command
        this.emitStatus('pitch:' + parameters[0] );
        break;
      }

      case 'roll':
      {
        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending roll update: ' + command);
        // Ack command
        this.emitStatus('roll:' + parameters[0] );
        break;
      }

      case 'strafe':
      {
        this.sendToMqtt ( pro4Buffer );
        logger.debug('Sending strafe update: ' + command);
        // Ack command
        this.emitStatus('strafe:' + parameters[0] );
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

  sendToMqtt ( pro4Buffer )
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
}

module.exports = Bridge;