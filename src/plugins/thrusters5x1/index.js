function thrusters5x1(name, deps) {
  deps.logger.debug('The motor_diags plugin.');
  //instance variables
  this.cockpit = deps.cockpit;
  this.global = deps.globalEventLoop;
  this.deps = deps;
  this.settings;
}
thrusters5x1.prototype.start = function start() {
  var self = this;

  //While we work on the best pattern this is a work around to make sure the MCU
  //gets the motor settings.  Every 30 seconds they get resent, or immediatly after
  //settings have changed.  This decouples the timing issues around the MCU not coming
  //up at the same time the Node module.
  this.settingtimer = setInterval(function(){self.SendMotorSettings()},30000)

  self.cockpit.on('callibrate_escs', function () {
    self.deps.globalEventLoop.emit('mcu.SendCommand', 'mcal()');
    self.deps.logger.debug('mcal() sent');
  });
  self.cockpit.on('plugin.thrusters5x1.motorTest', function (positions) {
    self.deps.globalEventLoop.emit('mcu.SendMotorTest', positions.thruster, positions.starboard, positions.vertical, positions.aftstarboard, positions.aftvertical);
  });
  self.global.withHistory.on('settings-change.thrusters5x1', function (data) {  
    self.settings = data.thrusters5x1;
    self.SendMotorSettings();
  });
};

thrusters5x1.prototype.SendMotorSettings = function SendMotorSettings() {
    if (!this.settings){return;}
    var settings = this.settings;
    var thruster = settings.thruster['forward-modifier'];
    var vertical = settings.vertical['forward-modifier'];
    var starboard = settings.starboard['forward-modifier'];
    var aftvertical = settings.vertical['forward-modifier'];
    var aftstarboard = settings.starboard['forward-modifier'];
    var nthruster = settings.thruster['reverse-modifier'];
    var nvertical = settings.vertical['reverse-modifier'];
    var nstarboard = settings.starboard['reverse-modifier'];
    var naftvertical = settings.vertical['reverse-modifier'];
    var naftstarboard = settings.starboard['reverse-modifier'];
    if (settings.thruster.reversed) {
      thruster = thruster * -1;
      nthruster = nthruster * -1;
    }
    if (settings.vertical.reversed) {
      vertical = vertical * -1;
      nvertical = nvertical * -1;
    }
    if (settings.starboard.reversed) {
      starboard = starboard * -1;
      nstarboard = nstarboard * -1;
    }
    if (settings.aftvertical.reversed) {
      aftvertical = aftvertical * -1;
      naftvertical = naftvertical * -1;
    }
    if (settings.aftstarboard.reversed) {
      aftstarboard = aftstarboard * -1;
      naftstarboard = naftstarboard * -1;
    }

    //todo: Move to motor-diag plugin
    //API to Arduino to pass a percent in 2 decimal accuracy requires multipling by 100 before sending.
    command = 'mtrmod1(' + thruster * 100 + ',' + vertical * 100 + ',' + starboard * 100 + ',' + aftvertical * 100 + ',' + aftstarboard * 100 + ')';
    this.global.emit('mcu.SendCommand', command);
    command = 'mtrmod2(' + nthruster * 100 + ',' + nvertical * 100 + ',' + nstarboard * 100 + ',' + naftvertical * 100 + ',' + naftstarboard * 100 + ')';
    this.global.emit('mcu.SendCommand', command);
  }

thrusters5x1.prototype.getSettingSchema = function getSettingSchema() {
  return [{
      'title': 'Thrusters',
      'description' : 'Settings for thrusters in a 5x1 (2 Port/Starboard X 2 Vertical X 1 Lateral)',
      'category': 'hardware',
      'id': 'thrusters5x1',
      'type': 'object',
      'properties': {
        'motor-response-delay-ms': {
          'type': 'number',
          'title': 'Motor response delay (ms)',
          'description' : 'Response delay will smooth out thruster accelerations over time which prevents large current spikes.',
          'minimum': 0,
          'maximum': 100,
          'default': 0
        },
        'thruster': {
          'title:': 'Thruster Motor',
          'type': 'object',
          'properties': {
            'reversed': {
              'type': 'boolean',
              'format': 'checkbox',
              'default': false
            },
            'forward-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',
              'type': 'number',
              'default': 1
            },
            'reverse-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            }
          }
        },
        'vertical': {
          'title:': 'Fore Vertical Motor',
          'type': 'object',
          'properties': {
            'reversed': {
              'type': 'boolean',
              'format': 'checkbox',
              'default': false
            },
            'forward-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            },
            'reverse-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            }
          }
        },
        'starboard': {
          'title:': 'Fore Starboards Motor',
          'type': 'object',
          'properties': {
            'reversed': {
              'type': 'boolean',
              'format': 'checkbox',
              'default': false
            },
            'forward-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            },
            'reverse-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            }
          }
        },
        'aftvertical': {
          'title:': 'Aft Vertical Motor',
          'type': 'object',
          'properties': {
            'reversed': {
              'type': 'boolean',
              'format': 'checkbox',
              'default': false
            },
            'forward-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            },
            'reverse-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            }
          }
        },
        'aftstarboard': {
          'title:': 'Aft Starboard Motor',
          'type': 'object',
          'properties': {
            'reversed': {
              'type': 'boolean',
              'format': 'checkbox',
              'default': false
            },
            'forward-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            },
            'reverse-modifier': {
              'description' : 'Used to adjust the power sent to the motor so that thrusters provide equal thrust',              
              'type': 'number',
              'default': 1
            }
          }
        }
      }
    }];
};
//Expose either a function or object for require
module.exports = function (name, deps) {
  return new thrusters5x1(name, deps);
};