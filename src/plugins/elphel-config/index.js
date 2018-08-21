(function()
{
    const Listener = require( 'Listener' );
    const request = require( 'request' );

    class ElphelConfig
    {
        constructor(name, deps)
        {
            deps.logger.debug( 'ElphelConfig plugin loaded!' );

            this.globalBus  = deps.globalEventLoop;   // This is the server-side messaging bus. The MCU sends messages to server plugins over this
            this.cockpitBus = deps.cockpit;           // This is the server<->client messaging bus. This is how the server talks to the browser

            this.hasSaidHello = false;

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

                resolution: new Listener( self.globalBus, 'plugin.elphel-config.resolution', false, function( powerIn )
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

                quality: new Listener( self.globalBus, 'plugin.elphel-config.quality', false, function( powerIn )
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

                exposure: new Listener( self.globalBus, 'plugin.elphel-config.exposure', false, function( powerIn )
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

                snapFull: new Listener( self.globalBus, 'plugin.elphel-config.snapFull', false, function( powerIn )
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

                sayHello: new Listener( self.cockpitBus, 'plugin.elphel-config.sayHello', false, function( powerIn )
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
                      'minimum': 70,
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
