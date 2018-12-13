(function()
{
    const Listener = require( 'Listener' );
    const request  = require( 'request' );
    const mqtt     = require( 'mqtt' );
    const parseString = require('xml2js').parseString;
    const fs       = require( 'fs' );
    const child    = require( 'child_process' );

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
            this.quality = 85; // 85% JPEG compression
            this.exposure = 100000; // in microseconds
            this.resolution = 4; // 1/n resolution

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
                    // if camera connects to MQTT broker, send normal defaults one time
                    if (client.id.match('elphel.*') !== null) {
                        let cameraIp = client.connection.stream.remoteAddress;
                        let defaultsUri;
                        if (cameraIp === '192.168.2.215')
                          defaultsUri = `http://${cameraIp}/setparameters_demo.php?AUTOEXP_ON=0&WB_EN=1&FLIPH=1&FLIPV=1`;
                        else
                          defaultsUri = `http://${cameraIp}/setparameters_demo.php?AUTOEXP_ON=0&WB_EN=1`;
                        deps.logger.debug(`ELPHEL-CONFIG: New camera joined at IP address ${cameraIp}`);
                        request({timeout: 2000, uri: defaultsUri}, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Default settings set on camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                                // add IP to cameraMap with default properties on success
                                if (!self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp] = {};
                            }
                            if (err) {
                                deps.logger.error('ELPHEL-CONFIG: Setting defaults failed with error:', err);
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
                        request({timeout: 2000, uri:`http://${cameraIp}/setparameters_demo.php?BIN_HOR=${resolution}&BIN_VERT=${resolution}&DCM_HOR=${resolution}&DCM_VERT=${resolution}`}, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Set resolution 1/${resolution} on camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].resolution = resolution;
                            }
                            if (err) {
                                deps.logger.error(`ELPHEL-CONFIG: Setting resolution on camera ${cameraIp} failed with error: ${err}`);
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
                        request({timeout: 2000, uri:`http://${cameraIp}/setparameters_demo.php?QUALITY=${quality}`}, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting JPEG quality ${quality}% on camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].quality = quality;
                            }
                            if (err) {
                                deps.logger.error(`ELPHEL-CONFIG: Setting JPEG quality on camera ${cameraIp} failed with error: ${err}`);
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
                    if ((exposure >= 1 && exposure <= 300) || exposure === 1 || exposure === -1) {
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
                        request({timeout: 2000, uri:`http://${cameraIp}/setparameters_demo.php?EXPOS=${newExposure}`}, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Setting exposure ${newExposure}us on camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                                if (self.cameraMap.hasOwnProperty(cameraIp))
                                    self.cameraMap[cameraIp].exposure = newExposure;
                            }
                            if (err) {
                                deps.logger.error(`ELPHEL-CONFIG: Setting exposure on camera ${cameraIp} failed with error: ${err}`);
                            }
                        });
                    }
                    else {
                        deps.logger.error(`ELPHEL-CONFIG: Invalid exposure value ${exposure}ms for camera ${cameraIp} - ignoring`);
                    }
                }),

                snapFull: new Listener( self.cockpitBus, 'plugin.elphel-config.snapFull', false, function( cameraIp )
                {
                    let filename = new Date().toISOString();
                    filename = filename.replace(/[\.\-T:]/g, '_').replace(/Z/, '');
                    let ts;
                    let id;
                    // Send command to camera
                    if (cameraIp === 'pilot')
                        cameraIp = process.env['EXTERNAL_CAM_IP'];
                    if (self.cameraMap.hasOwnProperty(cameraIp)) {
                        ts = self.cameraMap[cameraIp].ts;
                        id = self.cameraMap[cameraIp].id;
                        // request() will follow redirects by default
                        let url = `http://${cameraIp}/snapfull.php`;
                        request({timeout: 5000, uri: url, encoding: null}, function(err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Snapped full resolution image from camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                                fs.writeFile(`/opt/openrov/images/${ts}/${id}/snap_${filename}.jpg`, body, 'binary', function (err) {
                                    deps.logger.info(`ELPHEL-CONFIG: Error trying to write snapFull request on camera ${cameraIp} error: ${err}`);
                                });
                            }
                            if (err) {
                                deps.logger.error(`ELPHEL-CONFIG: Getting full resolution snapshot on ${cameraIp}  failed with error: ${err}`);
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
                        request({timeout: 2000, uri:`http://${cameraIp}/setparameters_demo.php?COLOR=${color}`}, function (err, response, body) {
                            if (response && response.statusCode == 200) {
                                deps.logger.debug(`ELPHEL-CONFIG: Set color ${colorText} on camera ${cameraIp}`);
                                self.cockpitBus.emit('plugin.elphel-config.getCamSettings', cameraIp);
                            }
                            if (err) {
                                deps.logger.error(`ELPHEL-CONFIG: Setting color on camera ${cameraIp} failed with error: ${err}`);
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
                    let subProp = 'unknown';
                    // Send command to camera
                    if (cameraIp === 'pilot')
                      cameraIp = process.env['EXTERNAL_CAM_IP'];
                    if (self.cameraMap.hasOwnProperty(cameraIp)) {
                      subProp = cameraIp.split('.')[3];
                    }
                    let prop = `camera.${subProp}`;
                    let statusobj = {};
                    request({timeout: 2000, uri:`http://${cameraIp}/${onBoardTemp}`}, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            parseString(body, function (err, result) {
                                if (result) {
                                    deps.logger.debug(`ELPHEL-CONFIG: Onboard temperature ${result.i2c.data} on camera ${cameraIp}`);
                                    // Emit temperature (in degrees C) and camera ID to telemetry plugin
                                    statusobj[prop] = parseInt(result.i2c.data);
                                    self.globalBus.emit('mcu.status', statusobj);
                                }
                                else if (err) {
                                    statusobj[prop] = -1;
                                    self.globalBus.emit('mcu.status', statusobj);
                                    deps.logger.error(`ELPHEL-CONFIG: Onboard temperature response XML parsing error: ${err}`);
                                }
                            });
                        }
                        if (err) {
                            deps.logger.error(`ELPHEL-CONFIG: Getting onBoard temperature on camera ${cameraIp} failed with error: ${err}`);
                        }
                    });
                }),

                getCamSettings: new Listener( self.cockpitBus, 'plugin.elphel-config.getCamSettings', false, function( cameraIp )
                {
                    let settingsPath = 'parsedit.php?immediate&COLOR&EXPOS&QUALITY&DCM_HOR&FLIPV&FLIPH&AUTOEXP_ON&WB_EN';
                    let subProp = 'unknown';
                    // Send command to camera
                    if (cameraIp === 'pilot')
                      cameraIp = process.env['EXTERNAL_CAM_IP'];
                    if (self.cameraMap.hasOwnProperty(cameraIp)) {
                      subProp = cameraIp.split('.')[3];
                    }
                    let prop = `camera.${subProp}`;
                    let statusobj = {};
                    request({timeout: 2000, uri:`http://${cameraIp}/${settingsPath}`}, function (err, response, body) {
                        if (response && response.statusCode == 200) {
                            parseString(body, function (err, result) {
                                if (result) {
                                  if (result.hasOwnProperty('parameters')) {
                                    if (result.parameters.hasOwnProperty('COLOR'))
                                      statusobj[`${prop}.color`] = parseInt(result.parameters.COLOR);
                                    if (result.parameters.hasOwnProperty('EXPOS'))
                                      statusobj[`${prop}.exposure`] = parseInt(result.parameters.EXPOS)/1000; // ms
                                    if (result.parameters.hasOwnProperty('QUALITY'))
                                      statusobj[`${prop}.quality`] = parseInt(result.parameters.QUALITY);
                                    if (result.parameters.hasOwnProperty('DCM_HOR'))
                                      statusobj[`${prop}.resolution`] = parseInt(result.parameters.DCM_HOR);
                                    if (result.parameters.hasOwnProperty('FLIPV'))
                                      statusobj[`${prop}.flipv`] = parseInt(result.parameters.FLIPV);
                                    if (result.parameters.hasOwnProperty('FLIPH'))
                                      statusobj[`${prop}.fliph`] = parseInt(result.parameters.FLIPH);
                                    if (result.parameters.hasOwnProperty('AUTOEXP_ON'))
                                      statusobj[`${prop}.autoexposure`] = parseInt(result.parameters.AUTOEXP_ON);
                                    if (result.parameters.hasOwnProperty('WB_EN'))
                                      statusobj[`${prop}.whitebalance`] = parseInt(result.parameters.WB_EN);
                                  }
                                    deps.logger.debug(`ELPHEL-CONFIG: getCamSettings successful on ${cameraIp} settings`);
                                    self.globalBus.emit('mcu.status', statusobj);
                                }
                                else if (err) {
                                    statusobj[prop] = -1;
                                    self.globalBus.emit('mcu.status', statusobj);
                                    deps.logger.error(`ELPHEL-CONFIG: getCamSettings response XML parsing error: ${err}`);
                                }
                            });
                        }
                        if (err) {
                            deps.logger.error(`ELPHEL-CONFIG: getCamSettings on camera ${cameraIp} failed with error: ${err}`);
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
                clientId: 'camera-config',
                keepalive: 15,
                will: {
                    topic: 'status/openrov',
                    payload: 'ELPHEL-CONFIG: OpenROV MQTT client disconnected!',
                    qos: 0,
                    retain: false
                }
            });

            this.client.on('connect', () => {
                this.mqttConnected = true;
                deps.logger.info('ELPHEL-CONFIG: MQTT broker connection established!');
                //this.client.subscribe('$SYS/+/new/clients');
                this.client.subscribe('toCamera/#'); // receive all camera control requests
                this.client.subscribe('video/restart');
            });

            this.client.on('reconnect', () => {
                this.mqttConnected = true;
                deps.logger.warn('ELPHEL-CONFIG: MQTT broker re-connected!');
            });

            this.client.on('offline', () => {
                this.mqttConnected = false;
                deps.logger.warn('ELPHEL-CONFIG: MQTT broker connection offline!');
            });

            this.client.on('close', () => {
                // connection state is also set to false in class close() method
                this.mqttConnected = false;
                deps.logger.warn('ELPHEL-CONFIG: MQTT broker connection closed!');
            });

            this.client.on('error', (err) => {
                deps.logger.error('ELPHEL-CONFIG: MQTT error: ', err);
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
                            case 'temp':
                                self.cockpitBus.emit('plugin.elphel-config.temp', cameraIp);
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
                    self.cameraMap[val[0]].record = val[4]; // recording enabled true/false

                    if (!self.cameraMap.hasOwnProperty(val[1]))
                        self.cameraMap[val[1]] = {};
                    self.cameraMap[val[1]].port = val[0];
                    self.cameraMap[val[1]].id = val[2]; // either 'pilot' or last IP address octet
                    self.cameraMap[val[1]].ts = val[3]; // timestamp used for image record directory
                    self.cameraMap[val[1]].record = val[4]; // recording enabled true/false
                }
                else if (topic.match('video/restart') !== null)
                {
                  child.exec('killall mjpg_streamer', { timeout: 1000 }, (error, stdout, stderr) => {
                    if (error) {
                      deps.logger.error(`ELPHEL-CONFIG: Error ${error} trying to restart mjpg_streamer processes`);
                      return;
                    }
                    deps.logger.info('ELPHEL-CONFIG: Restarted mjpg_streamer processes');
                  });
                }
            });
        }

        requestCamTemp()
        {
          let self = this;

          for (let prop in self.cameraMap) {
            if (prop.match('820[0-9]') !== null)
              self.cockpitBus.emit('plugin.elphel-config.temp', self.cameraMap[prop].ipAddress);
          }
        }

        requestCamSettings()
        {
          let self = this;

          for (let prop in self.cameraMap) {
            if (prop.match('820[0-9]') !== null)
              self.cockpitBus.emit('plugin.elphel-config.getCamSettings', self.cameraMap[prop].ipAddress);
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
          this.listeners.color.enable();
          this.listeners.exposure.enable();
          this.listeners.snapFull.enable();
          this.listeners.sayHello.enable();
          this.listeners.temp.enable();
          this.listeners.getCamSettings.enable();
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
          this.listeners.color.disable();
          this.listeners.exposure.disable();
          this.listeners.snapFull.disable();
          this.listeners.sayHello.disable();
          this.listeners.temp.disable();
          this.listeners.getCamSettings.disable();
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
                'category': 'general',
                'properties': {
                  'exposureMillis': {
                    'type': 'integer',
                    'title': 'Exposure (ms)',
                    'description': 'Default Elphel camera sensor exposure value in milliseconds',
                    'default': 100,
                    'minimum': 1,
                    'maximum': 500
                  },
                  'jpgQuality': {
                      'type': 'integer',
                      'title': 'JPEG Quality',
                      'description': 'Default Elphel camera sensor JPEG compression quality value',
                      'default': 85,
                      'minimum': 60,
                      'maximum': 100
                  },
                  'resolution': {
                    'type': 'integer',
                    'title': 'Camera resolution (1/n)',
                    'description': 'Default Elphel camera resolution - valid values are 1, 2, and 4 for full, half, and quarter resolution',
                    'default': 4,
                    'minimum': 1,
                    'maximum': 4
                  },
                  'autoExposure': {
                    'type': 'boolean',
                    'title': 'Autoexposure',
                    'description': 'Enable/disable Elphel auto-exposure',
                    'default': false
                  },
                  'whiteBalance': {
                    'type': 'boolean',
                    'title': 'White balance',
                    'description': 'Enable/disable Elphel automatic white balance',
                    'default': false
                  },
                  'colorMode': {
                    'type': 'boolean',
                    'title': 'Enable raw (JP4) mode',
                    'description': 'true = enable JP4 raw image streaming (requires special decoder; false = use normal color mode',
                    'default': false
                  }
                },
                'required': [
                  'exposureMillis',
                  'jpgQuality',
                  'resolution',
                  'autoExposure',
                  'whiteBalance',
                  'colorMode'
                ]
            }];
        }
    }

    module.exports = function(name, deps)
    {
        return new ElphelConfig(name, deps);
    };
}());
