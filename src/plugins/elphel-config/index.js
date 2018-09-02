(function()
{
    const Listener = require( 'Listener' );
    const request  = require( 'request' );
    const mqtt     = require( 'mqtt' );
    const parseString = require('xml2js').parseString;
    const fs       = require( 'fs' );

    class ElphelConfig
    {
        constructor(name, deps)
        {
            deps.logger.debug( 'ElphelConfig plugin loaded!' );

            this.globalBus  = deps.globalEventLoop;   // This is the server-side messaging bus. The MCU sends messages to server plugins over this
            this.cockpitBus = deps.cockpit;           // This is the server<->client messaging bus. This is how the server talks to the browser

            this.hasSaidHello = false;

            let self = this;

            // Mqtt info
            this.mqttConnected = false;
            this.mqttUri    = 'ws://127.0.0.1:3000';

            // holds camera settings from mjpeg-video-server
            this.cameraMap = {};

            // camera defaults to send on mqtt clientConnect
            this.quality = 90; // 90% JPEG compression
            this.exposure = 50000; // in microseconds
            this.resolution = 1; // 1/n resolution

            // Pre-define all of the event listeners here. We defer enabling them until later.
            // Look at src/libs/Listener.js to see how these work.
            this.listeners =
            {
                // Listener for Settings updates
                settings: new Listener( self.globalBus, 'settings-change.elphel-config', true, function( settings )
                {
                    // Apply settings
                    self.settings = settings['elphel-config'];

                    // Emit settings update to cockpit
                    self.cockpitBus.emit( 'plugin.elphel-config.settingsChange', self.settings );
                }),

                // Listener for MQTT clientConnected
                clientConnected: new Listener( self.globalBus, 'plugin.mqttBroker.clientConnected', true, function( client )
                {
                    deps.logger.debug(`ELPHEL-CONFIG: New MQTT client connected ${client.id}`);
                    // if camera connect to MQTT broker, send normal defaults one time
                    if (client.id.match('elphel.*') !== null) {
                        let cameraIp = client.connection.stream.remoteAddress;
                        deps.logger.debug(`ELPHEL-CONFIG: New camera joined at IP address ${cameraIp}`);
                        request(`http://${cameraIp}/setparameters_demo.php?AUTOEXP_ON=0&WB_EN=0&QUALITY=${self.quality}&EXPOS=${self.exposure}&BCH_HOR=${self.resolution}&BIN_VERT=${self.resolution}&DCM_HOR=${self.resolution}&DCM_VERT=${self.resolution}`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                                // add IP to cameraMap with default properties on success
                                if (!self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp] = {};
                                self.cameraMap[cameraIp].quality = self.quality;
                                self.cameraMap[cameraIp].resolution = self.resolution;
                                self.cameraMap[cameraIp].exposure = self.exposure;

                            }
                            if (err) {
                                deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
                            }
                        });
                    }
                }),

                // Listener for MCU status messages
                mcuStatus: new Listener( self.globalBus, 'mcu.status', false, function( data )
                {
                    // Check for the elphel-config field name in the MCU's status update
                    if( 'elphel-config' in data )
                    {
                        // Get the message that the MCU sent to us
                        var message = data['elphel-config'];

                        // Re-emit the message on the cockpit messaging bus (talks to the browser)
                        self.cockpitBus.emit( 'plugin.elphel-config.message', message );
                    }
                }),

                resolution: new Listener( self.cockpitBus, 'plugin.elphel-config.resolution', false, function( cameraIp, resolution )
                {
                    let valid = [1, 2, 4];
                    if (valid.indexOf(resolution) > -1) {
                        // Send command to camera
                        if (cameraIp === 'pilot')
                            cameraIp = process.env['EXTERNAL_CAM_IP'];
                        request(`http://${cameraIp}/setparameters_demo.php?BCH_HOR=${resolution}&BIN_VERT=${resolution}&DCM_HOR=${resolution}&DCM_VERT=${resolution}`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Set resolution 1/${resolution} on camera ${cameraIp}`);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].resolution = resolution;
                            }
                            if (err) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting resolution on camera ${cameraIp} failed with error: ${err}`);
                            }
                        });
                    }
                    else {
                        deps.logger.debug(`ELPHEL-CONFIG: Invalid resolution value 1/${resolution} for camera ${cameraIp} - ignoring`);
                    }
                }),

                quality: new Listener( self.cockpitBus, 'plugin.elphel-config.quality', false, function( cameraIp, quality )
                {
                    if (quality >= 60 && quality <= 100) {
                        // Send command to camera
                        if (cameraIp === 'pilot')
                            cameraIp = process.env['EXTERNAL_CAM_IP'];
                        request(`http://${cameraIp}/setparameters_demo.php?QUALITY=${quality}`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting JPEG quality ${quality}% on camera ${cameraIp}`);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].quality = quality;
                            }
                            if (err) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting JPEG quality on camera ${cameraIp} failed with error: ${err}`);
                            }
                        });
                    }
                    else {
                        deps.logger.debug(`ELPHEL-CONFIG: Invalid quality value ${quality}% for camera ${cameraIp} - ignoring`);
                    }
                }),

                exposure: new Listener( self.cockpitBus, 'plugin.elphel-config.exposure', false, function( cameraIp, exposure )
                {
                    let newExposure;
                    if ((exposure >= 10 && exposure <= 250) || exposure === 1 || exposure === -1) {
                        // Send command to camera
                        if (cameraIp === 'pilot')
                            cameraIp = process.env['EXTERNAL_CAM_IP'];
                        if (self.cameraMap.hasOwnProperty(cameraIp)) {
                            if (self.cameraMap[cameraIp].hasOwnProperty('exposure') && (exposure === 1 || exposure === -1)) {
                                newExposure = self.cameraMap[cameraIp].exposure + exposure * 1000; // value should be in microseconds
                            }
                            else {
                                newExposure = exposure * 1000; // value should be in microseconds
                            }
                        }
                        request(`http://${cameraIp}/setparameters_demo.php?EXPOS=${newExposure}`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting exposure ${newExposure}us on camera ${cameraIp}`);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].exposure = newExposure;
                            }
                            if (err) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting exposure on camera ${cameraIp} failed with error: ${err}`);
                            }
                        });
                    }
                    else {
                        deps.logger.debug(`ELPHEL-CONFIG: Invalid exposure value ${exposure}ms for camera ${cameraIp} - ignoring`);
                    }
                }),

                snapFull: new Listener( self.cockpitBus, 'plugin.elphel-config.snapFull', false, function( cameraIp )
                {
                    let filename = new Date();
                    let ts;
                    let id;
                    // Send command to camera
                    if (cameraIp === 'pilot')
                        cameraIp = process.env['EXTERNAL_CAM_IP'];
                    if (self.cameraMap.hasOwnProperty(cameraIp)) {
                        ts = self.cameraMap[cameraIp].ts;
                        id = self.cameraMap[cameraIp].id;
                        // request() will follow redirects by default
                        let uri = `http://${cameraIp}/snapfull.php`;
                        request(uri, {encoding: 'binary'}, function(err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Snapped full resolution image from camera ${cameraIp}`);
                                fs.writeFile(`/opt/openrov/images/${ts}/${id}/${filename.toISOString()}_full.jpg`, body, 'binary', function (err) {
                                    deps.logger.info(`ELPHEL-CONFIG: Error trying to write snapFull request on camera ${cameraIp} error: ${err}`);
                                });
                            }
                            if (err) {
                                deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
                            }
                        });
                    }
                }),

                color: new Listener( self.cockpitBus, 'plugin.elphel-config.color', false, function( cameraIp, color )
                {
                    if (color === 1 || color === 5) {
                        let colorText = color === 1 ? 'normal' : 'raw';
                        // Send command to camera
                        if (cameraIp === 'pilot')
                            cameraIp = process.env['EXTERNAL_CAM_IP'];
                        request(`http://${cameraIp}/setparameters_demo.php?COLOR=${color}`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Set color ${colorText} on camera ${cameraIp}`);
                            }
                            if (err) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting color on camera ${cameraIp} failed with error: ${err}`);
                            }
                        });
                    }
                    else {
                        deps.logger.debug(`ELPHEL-CONFIG: Invalid color value ${color} for camera ${cameraIp} - ignoring`);
                    }
                }),

                temp: new Listener( self.cockpitBus, 'plugin.elphel-config.temp', false, function( cameraIp )
                {
                    let onBoardTemp = 'i2c.php?width=8&bus=1&adr=0x4800';
                    let port = 'unknown';
                    // Send command to camera
                    if (cameraIp === 'pilot')
                        cameraIp = process.env['EXTERNAL_CAM_IP'];
                    if (self.cameraMap.hasOwnProperty(cameraIp)) {
                        port = self.cameraMap[cameraIp].port;
                    }
                    let prop = `camTemp.${port}`;
                    let statusobj = {};
                    request(`http://${cameraIp}/${onBoardTemp}`, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            parseString(body, function (err, result) {
                                if (result) {
                                    deps.logger.debug(`ELPHEL-CONFIG: Onboard temperature ${result.i2c.data} on camera ${cameraIp}`);
                                    // Emit temperature and camera ID to telemetry plugin
                                    statusobj[prop] = result.i2c.data + 'C';
                                    self.globalBus.emit('mcu.status', statusobj);
                                }
                                else if (err) {
                                    statusobj[prop] = 'nodata';
                                    self.globalBus.emit('mcu.status', statusobj);
                                    deps.logger.debug(`ELPHEL-CONFIG: Onboard temperature request parsing error: ${err}`);
                                }
                            });
                        }
                        if (err) {
                            deps.logger.debug(`ELPHEL-CONFIG: Getting onBoard temperature on camera ${cameraIp} with error: ${err}`);
                        }
                    });
                }),

                sayHello: new Listener( self.cockpitBus, 'plugin.elphel-config.sayHello', false, function()
                {
                    var command;

                    // Create a command in the format "command( parameters )"
                    if( self.hasSaidHello )
                    {
                      command = 'ex_hello(' + 0 + ')';
                      self.hasSaidHello = false;
                    }
                    else
                    {
                      command = 'ex_hello(' + 1 + ')';
                      self.hasSaidHello = true;
                    }

                    // Send command to mcu
                    self.globalBus.emit( 'mcu.SendCommand', command );
                })
            }

            // Connect to MQTT broker and setup all event handlers
            // This is used to publish camera settings to camera viewers for controls
            this.client = mqtt.connect(this.mqttUri, {
                protocolVersion: 4,
                resubscribe: true,
                will: {
                    topic: 'status/openrov',
                    payload: 'ELPHEL-CONFIG: OpenROV MQTT client disconnected!',
                    qos: 0,
                    retain: false
                }
            });

            this.client.on('connect', () => {
                this.mqttConnected = true;
                deps.logger.debug('ELPHEL-CONFIG: MQTT broker connection established!');
                this.client.subscribe('toCamera/#'); // receive all camera control requests
            });

            this.client.on('reconnect', () => {
                this.mqttConnected = true;
                deps.logger.debug('ELPHEL-CONFIG: MQTT broker re-connected!');
            });

            this.client.on('offline', () => {
                this.mqttConnected = false;
                deps.logger.debug('ELPHEL-CONFIG: MQTT broker connection offline!');
            });

            this.client.on('close', () => {
                // connection state is also set to false in class close() method
                this.mqttConnected = false;
                deps.logger.debug('ELPHEL-CONFIG: MQTT broker connection closed!');
            });

            this.client.on('error', (err) => {
                deps.logger.debug('ELPHEL-CONFIG: MQTT error: ', err);
            });

            this.client.on('message', (topic, message) => {
                // handle Elphel camera control messages from the view-only browser clients
                // and re-emit them as events
                // openrov-cockpit pilot user emits events directly to handlers above
                if (topic.match('toCamera/820[0-9]/.*') !== null) {
                    let command = topic.split('/');
                    let port = command[1];
                    let func = command[2];
                    let value = parseInt(message, 10);
                    let cameraIp;
                    if (self.cameraMap.hasOwnProperty(port))
                    {
                        cameraIp = self.cameraMap[port].ipAddress;
                        switch(func)
                        {
                            case 'exposure':
                                self.cockpitBus.emit('plugin.elphel-config.exposure', cameraIp, value);
                                break;
                            case 'resolution':
                                self.cockpitBus.emit('plugin.elphel-config.resolution', cameraIp, value);
                                break;
                            case 'quality':
                                self.cockpitBus.emit('plugin.elphel-config.quality', cameraIp, value);
                                break;
                            case 'color':
                                // raw/normal events not available in viewer client controls yet
                                self.cockpitBus.emit('plugin.elphel-config.color', cameraIp, value);
                                break;
                            case 'snapFull':
                                self.cockpitBus.emit('plugin.elphel-config.snapFull', cameraIp, value);
                                break;
                            default:
                                break;
                        }
                    }


                }
                else if (topic.match('toCamera/cameraRegistration') !== null)
                {
                    // add both port and ipAddress as keys to aid lookups for pilot cam
                    let val = message.toString().split(':');
                    self.cameraMap[val[0]] = {};
                    self.cameraMap[val[0]].ipAddress = val[1];
                    self.cameraMap[val[0]].id = val[2]; // either 'pilot' or last IP address octet
                    self.cameraMap[val[0]].ts = val[3]; // timestamp used for image record directory

                    if (!self.cameraMap.hasOwnProperty(val[1]))
                        self.cameraMap[val[1]] = {};
                    self.cameraMap[val[1]].port = val[0];
                    self.cameraMap[val[1]].id = val[2]; // either 'pilot' or last IP address octet
                    self.cameraMap[val[1]].ts = val[3]; // timestamp used for image record directory
                }
            });
        }

        // This is automatically called when cockpit loads all of the plugins, and when a plugin is enabled
        start()
        {
          // Enable the listeners!
          this.listeners.settings.enable();
          this.listeners.clientConnected.enable();
          this.listeners.mcuStatus.enable();
          this.listeners.resolution.enable();
          this.listeners.quality.enable();
          this.listeners.exposure.enable();
          this.listeners.snapFull.enable();
          this.listeners.sayHello.enable();
        }

        // This is called when the plugin is disabled
        stop()
        {
          // Disable listeners
          this.listeners.settings.disable();
          this.listeners.clientConnected.disable();
          this.listeners.mcuStatus.disable();
          this.listeners.resolution.disable();
          this.listeners.quality.disable();
          this.listeners.exposure.disable();
          this.listeners.snapFull.disable();
          this.listeners.sayHello.disable();
        }

        // This is used to define user settings for the plugin. We populated some elphel-config properties below.
        // The UI for changing the settings is automatically generated in the Settings applet.
        getSettingSchema()
        {
            //from http://json-schema.org/elphel-configs.html
            return [{
                'title': 'ElphelConfig Plugin',
                'type': 'object',
                'id': 'elphel-config',
                'properties': {
                  'exposureMillis': {
                    'type': 'integer',
                    'title': 'Exposure (ms)',
                    'description': 'Default Elphel camera sensor exposure value in milliseconds',
                    'default': 30,
                    'minimum': 5,
                    'maximum': 300
                  },
                  'jpgQuality': {
                      'type': 'integer',
                      'title': 'JPEG Quality',
                      'description': 'Default Elphel camera sensor JPEG compression quality value',
                      'default': 90,
                      'minimum': 60,
                      'maximum': 100
                  },
                  'resolution': {
                    'type': 'integer',
                    'title': 'Camera resolution (1/n)',
                    'description': 'Default Elphel camera resolution - valid values are 1, 2, and 4 for full, half, and quarter resolution',
                    'default': 1,
                    'minimum': 1,
                    'maximum': 4
                  },
                  'autoExposure': {
                    'type': 'boolen',
                    'title': 'Autoexposure',
                    'description': 'Enable/disable Elphel auto-exposure',
                    'default': false
                  },
                  'whiteBalance': {
                    'type': 'boolen',
                    'title': 'White balance',
                    'description': 'Enable/disable Elphel automatic white balance',
                    'default': false
                  }
                },
                'required': [
                  'exposureMillis',
                  'jpgQuality',
                  'resolution',
                  'autoExposure',
                  'whiteBalance'
                ]
            }];
        }
    }

    module.exports = function(name, deps)
    {
        return new ElphelConfig(name, deps);
    };
}());
