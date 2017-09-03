const mqtt = require('mqtt');
const EventEmitter  = require('events').EventEmitter;
const logger        = require('AppFramework.js').logger;

class Bridge extends EventEmitter
{
  constructor( mqttBrokerIp )
  {
    super();

    this.emitRawSerial = false;
    this.mqttConnected = false;
    this.client = {};
    this.mqttUri = 'ws://' + mqttBrokerIp + ':1883';
  }

  connect()
  {
    // Connect to MQTT broker and setup all event handlers
    // Note that platform code is loaded before MQTT broker plugin, so the 
    // client may attempt a few reconnects until it is successful
    this.client = mqtt.connect(mqttUri, {
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
/*
    // Review parser function
    parser.on('data', (data) =>
    {
      var status = this.parseStatus( data.toString('utf8' ) );

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
    logger.debug('Received bridge close().  Closing MQTT broker connection.');
    this.client.end(false, () => {
      logger.debug('MQTT this.client.end() returned.');
      this.mqttConnected = false;
    });
  }

  write( command )
  {
    // Create buffer for crc+command
    let messagebuffer = new Buffer( command.length + 1 );

    // this could be where the device-specific protocol translation occurs
    // (ie: PRO4)

    // Write command
    messagebuffer.write( command, 1, command.length, 'utf-8' );

    // For testing just send to status topic
    // Need code to map messages to appropriate topics
    if( this.mqttConnected ) 
    {
      this.client.publish('status/openrov', messagebuffer);

      if( this.emitRawSerial ) 
      {
        this.emit('serial-sent', command );
      }
    } 
    else
    {
      logger.debug('BRIDGE: DID NOT SEND. Not connected');
    }
  }

  /*
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
 */

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
}

module.exports = Bridge;