(function()
{
    const Listener = require( 'Listener' );
    const request  = require( 'request' );
    const mqtt     = require( 'mqtt' );

    class ElphelConfig
    {
        constructor(name, deps)
        {
            deps.logger.debug( 'ElphelConfig plugin loaded!' );

            this.globalBus  = deps.globalEventLoop;   // This is the server-side messaging bus. The MCU sends messages to server plugins over this
            this.cockpitBus = deps.cockpit;           // This is the server<->client messaging bus. This is how the server talks to the browser

            this.hasSaidHello = false;

            // Mqtt info
            this.mqttConnected = false;
            this.mqttUri    = 'ws://127.0.0.1:3000';

            // key = server port viewed by browser clients
            // value = source IP address of image stream
            this.cameraMap = {};
            var self = this;

            // Pre-define all of the event listeners here. We defer enabling them until later.
            // Look at src/libs/Listener.js to see how these work.
            this.listeners =
            {
                // Listener for Settings updates
                settings: new Listener( self.globalBus, 'settings-change.elphel-config', true, function( settings )
                {
                    // Apply settings
                    self.settings = settings['elphel-config'];
                    self.quality = self.settings.jpgQuality;
                    self.exposure = self.settings.exposureMillis;
                    self.resolution = self.settings.resolution;
                    self.ae = self.settings.autoExposure;

                    // Emit settings update to cockpit
                    self.cockpitBus.emit( 'plugin.elphel-config.settingsChange', self.settings );
                }),

                // Listener for MQTT clientConnected
                clientConnected: new Listener( self.globalBus, 'plugin.mqttBroker.clientConnected', true, function( client )
                {
                    if (client.id.match('elphel.*') !== null) {
                        let cameraIp = client.connection.stream.remoteAddress;
                        deps.logger.debug(`ELPHEL-CONFIG: New camera joined at IP address ${cameraIp}`);
                        request(`http://${cameraIp}/camvc.php?set=0/comp_run:stop/ae:${self.ae}/iq:${self.quality}/e:${self.exposure}/bh:${self.resolution}/bv:${self.resolution}/dh:${self.resolution}/dv:${self.resolution}/comp_run:run`, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
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

                resolution: new Listener( self.globalBus, 'plugin.elphel-config.resolution', false, function( cameraIp )
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

                    // Send command to camera
                    request(`http://${cameraIp}/camvc.php?set=0/comp_run:stop/ae:${self.ae}/iq:${self.quality}/e:${self.exposure}/bh:${self.resolution}/bv:${self.resolution}/dh:${self.resolution}/dv:${self.resolution}/comp_run:run`, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                        }
                        if (err) {
                            deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
                        }
                    });
                }),

                quality: new Listener( self.globalBus, 'plugin.elphel-config.quality', false, function( cameraIp )
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

                    // Send command to camera
                    request(`http://${cameraIp}/camvc.php?set=0/comp_run:stop/ae:${self.ae}/iq:${self.quality}/e:${self.exposure}/bh:${self.resolution}/bv:${self.resolution}/dh:${self.resolution}/dv:${self.resolution}/comp_run:run`, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                        }
                        if (err) {
                            deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
                        }
                    });
                }),

                exposure: new Listener( self.globalBus, 'plugin.elphel-config.exposure', false, function( cameraIp )
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

                    // Send command to camera
                    request(`http://${cameraIp}/camvc.php?set=0/comp_run:stop/ae:${self.ae}/iq:${self.quality}/e:${self.exposure}/bh:${self.resolution}/bv:${self.resolution}/dh:${self.resolution}/dv:${self.resolution}/comp_run:run`, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                        }
                        if (err) {
                            deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
                        }
                    });
                }),

                snapFull: new Listener( self.globalBus, 'plugin.elphel-config.snapFull', false, function( cameraIp )
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

                    // Send command to camera
                    request(`http://${cameraIp}/camvc.php?set=0/comp_run:stop/ae:${self.ae}/iq:${self.quality}/e:${self.exposure}/bh:${self.resolution}/bv:${self.resolution}/dh:${self.resolution}/dv:${self.resolution}/comp_run:run`, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                        }
                        if (err) {
                            deps.logger.debug('ELPHEL-CONFIG: Setting defaults failed with error:', err);
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
                    payload: 'MJPEG-VIDEO-SERVER: OpenROV MQTT client disconnected!',
                    qos: 0,
                    retain: false
                }
            });

            this.client.on('connect', () => {
                this.mqttConnected = true;
                deps.logger.debug('MJPEG-VIDEO-SERVER: MQTT broker connection established!');
                this.client.subscribe('toCamera/#'); // receive all camera control requests
            });

            this.client.on('reconnect', () => {
                this.mqttConnected = true;
                deps.logger.debug('MJPEG-VIDEO-SERVER: MQTT broker re-connected!');
            });

            this.client.on('offline', () => {
                this.mqttConnected = false;
                deps.logger.debug('MJPEG-VIDEO-SERVER: MQTT broker connection offline!');
            });

            this.client.on('close', () => {
                // connection state is also set to false in class close() method
                this.mqttConnected = false;
                deps.logger.debug('MJPEG-VIDEO-SERVER: MQTT broker connection closed!');
            });

            this.client.on('error', (err) => {
                deps.logger.debug('MJPEG-VIDEO-SERVER: MQTT error: ', err);
            });

            this.client.on('message', (topic, message) => {
                // handle Elphel camera control messages
                if (topic.match('toCamera/820[0-9]/.*') !== null) {
                    let command = topic.split('/');
                    let port = command[1];
                    let func = command[2];
                    let cameraIp = this.cameraMap[port];
                    let onBoardTemp = '/i2c.php?width=8&bus=1&adr=0x4800';
                    // WOI_LEFT=100&WOI_TOP=300&WOI_WIDTH=800&WOI_HEIGHT=600&DCM_HOR=1&DCM_VER=1&BIN_HOR=1&BIN_VER=1
                    let uri = `http://${cameraIp}/`;
                    switch(func) {
                        case 'exposure':
                            if (message >= 10 && message <= 250)
                                uri += `setparameters_demo.php?EXPOS=${message}`;
                            else
                                uri = 'ignore';
                            break;
                        case 'resolution':
                            let valid = [1, 2, 4];
                            if (valid.indexOf(message) > 0)
                                uri += `setparameters_demo.php?DCM_HOR=${message}&DCM_VERT=${message}&BIN_HOR=${message}&BIN_VERT=${message}`;
                            else
                                uri = 'ignore';
                            break;
                        case 'quality':
                            if (message >= 60 && message <= 100)
                                uri += `setparameters_demo.php?QUALITY=${message}`;
                            else
                                uri = 'ignore';
                            break;
                        case 'color':
                            if (message === 1 || message === 5)
                                uri += `setparameters_demo.php?COLOR=${message}`;
                            else
                                uri = 'ignore';
                            break;
                        case 'snapFull':
                            // request() will follow redirects by default
                            uri += `snapfull.php`;
                            request(uri, {encoding: 'binary'}, function(error, response, body) {
                                fs.writeFile(`/opt/openrov/images/`, body, 'binary', function (err) {});
                            });
                            uri = 'ignore';
                            break;
                        default:
                            uri = 'ignore';
                            break;
                    }
                    switch(uri) {
                        case 'ignore':
                            break;
                        default:
                            request(uri, function (err, response, body) {
                                deps.logger.debug('MJPEG-VIDEO-SERVER: request error:', err);
                                deps.logger.debug('MJPEG-VIDEO-SERVER: request statusCode:', response && response.statusCode);
                                deps.logger.debug('MJPEG-VIDEO-SERVER: body:', body);
                            });
                            break;
                    }
                }
                else if (topic.match('toCamera/cameraRegistration') !== null)
                {
                    let val = message.split(':');
                    this.cameraMap[val[0]] = val[1];
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
                    'description': 'Default Elphel AutoExposure boolean',
                    'default': false
                  }
                },
                'required': [
                  'exposureMillis',
                  'jpgQuality',
                  'resolution',
                  'autoExposure'
                ]
            }];
        }
    }

    module.exports = function(name, deps)
    {
        return new ElphelConfig(name, deps);
    };
}());
